import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import type { SessionPool } from './pool.js';
import type { TokenTracker } from './token-tracker.js';
import type { TranscriptReader, TranscriptTurn } from './transcript-reader.js';
import { formatTokens, formatTimeAgo } from './dashboard-route.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let templateCache: string | null = null;

function loadTemplate(): string {
  if (!templateCache) {
    templateCache = readFileSync(join(__dirname, 'transcript.html'), 'utf-8');
  }
  return templateCache;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function registerTranscriptRoutes(
  app: FastifyInstance,
  pool: SessionPool,
  tokenTracker: TokenTracker,
  transcriptReader: TranscriptReader,
): void {
  /**
   * GET /sessions/:id/transcript — Transcript browser for a specific session
   */
  app.get<{ Params: { id: string } }>('/sessions/:id/transcript', async (request, reply) => {
    const { id } = request.params;

    let statusInfo;
    try {
      statusInfo = pool.status(id);
    } catch {
      return reply.status(404).send({ error: `Session not found: ${id}` });
    }

    // Try to find and parse the session's JSONL transcript
    const sessions = transcriptReader.listSessions(statusInfo.workdir);
    let turns: TranscriptTurn[] = [];

    if (sessions.length > 0) {
      // Use the most recent session file
      turns = transcriptReader.getTranscript(sessions[0].file);
    }

    const usage = tokenTracker.getUsage(id);
    const methodSid = (statusInfo.metadata as Record<string, unknown> | undefined)?.methodology_session_id ?? null;
    const workdirShort = statusInfo.workdir.split(/[\\/]/).pop() ?? statusInfo.workdir;

    let html = loadTemplate();

    html = html.replace(/\{\{pageTitle\}\}/g, escapeHtml(statusInfo.nickname));
    html = html.replace(/\{\{nickname\}\}/g, escapeHtml(statusInfo.nickname));

    // Render banner
    const bannerHtml = `
    <div class="agent-banner">
      <div class="banner-top">
        <span class="banner-nickname">${escapeHtml(statusInfo.nickname)}</span>
      </div>
      <div class="banner-meta">
        <span>${escapeHtml(statusInfo.sessionId.substring(0, 8))}</span>
        <span>workdir ${escapeHtml(workdirShort)}</span>
        <span>method ${methodSid ? escapeHtml(String(methodSid)) : '&mdash;'}</span>
        <span>tokens ${usage ? formatTokens(usage.totalTokens) : '&mdash;'}</span>
        <span>cache ${usage ? Math.round(usage.cacheHitRate) + '%' : '&mdash;'}</span>
        <span>${formatTimeAgo(statusInfo.lastActivityAt)}</span>
      </div>
    </div>`;
    html = html.replace(/\{\{banner\}\}/g, bannerHtml);

    // Render turns
    if (turns.length === 0) {
      html = html.replace(/\{\{turns\}\}/g, '<div class="empty-state">No transcript data found</div>');
    } else {
      const turnsHtml = turns.map(turn => renderTurn(turn)).join('\n');
      html = html.replace(/\{\{turns\}\}/g, turnsHtml);
    }

    // Render summary
    const totalTurns = turns.length;
    const toolCallCount = turns.reduce((sum, t) => sum + (t.toolCalls?.length ?? 0), 0);
    const totalTokens = turns.reduce((sum, t) => {
      if (!t.tokens) return sum;
      return sum + t.tokens.input + t.tokens.output + t.tokens.cacheRead;
    }, 0);

    const summaryHtml = `
    <div class="summary-bar">
      <span><span class="val">${totalTurns}</span> turns</span>
      <span><span class="val">${toolCallCount}</span> tool calls</span>
      <span><span class="val">${formatTokens(totalTokens)}</span> tokens</span>
    </div>`;
    html = html.replace(/\{\{summary\}\}/g, summaryHtml);

    return reply.type('text/html').send(html);
  });

  /**
   * GET /transcripts — List available transcript sessions
   */
  app.get('/transcripts', async (_request, reply) => {
    const allSessions = pool.list();
    const workdirs = new Set(allSessions.map(s => s.workdir));
    const allTranscripts: Array<{
      workdir: string;
      file: string;
      modifiedAt: string;
      sizeBytes: number;
    }> = [];

    for (const wd of workdirs) {
      const sessions = transcriptReader.listSessions(wd);
      for (const s of sessions) {
        allTranscripts.push({ workdir: wd, ...s });
      }
    }

    // Simple JSON listing for now — the UI can be enhanced later
    return reply.status(200).send({
      transcripts: allTranscripts,
      count: allTranscripts.length,
    });
  });
}

function renderTurn(turn: TranscriptTurn): string {
  const roleClass = turn.role === 'user' ? 'turn-user' : 'turn-assistant';
  const time = new Date(turn.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const tokensStr = turn.tokens
    ? `in:${formatTokens(turn.tokens.input)} out:${formatTokens(turn.tokens.output)} cache:${formatTokens(turn.tokens.cacheRead)}`
    : '';

  // Truncate very long content for display
  const displayContent = turn.content.length > 3000
    ? turn.content.substring(0, 3000) + '\n\n[... truncated ...]'
    : turn.content;

  const toolCallsHtml = turn.toolCalls
    ? `<div class="tool-calls">${turn.toolCalls.map(tc => `
        <div class="tool-call">
          <div class="tool-call-header">
            <span class="tool-call-toggle"></span>
            <span class="tool-call-name">${escapeHtml(tc.name)}</span>
          </div>
          <div class="tool-call-input">${escapeHtml(tc.input)}</div>
        </div>`).join('')}</div>`
    : '';

  return `
  <div class="turn ${roleClass}">
    <div class="turn-header">
      <span class="turn-role">${turn.role}</span>
      <span class="turn-time">${escapeHtml(time)}</span>
      <span class="turn-tokens">${escapeHtml(tokensStr)}</span>
    </div>
    <div class="turn-content">${escapeHtml(displayContent)}</div>
    ${toolCallsHtml}
  </div>`;
}
