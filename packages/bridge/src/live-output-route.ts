import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import stripAnsi from 'strip-ansi';
import type { SessionPool } from './pool.js';
import type { TokenTracker } from './token-tracker.js';
import { formatTokens, formatUptime, formatTimeAgo } from './dashboard-route.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS ?? '15000', 10);

let templateCache: string | null = null;

function loadTemplate(): string {
  if (!templateCache) {
    templateCache = readFileSync(join(__dirname, 'live-output.html'), 'utf-8');
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

export function registerLiveOutputRoutes(
  app: FastifyInstance,
  pool: SessionPool,
  tokenTracker: TokenTracker,
): void {
  /**
   * GET /sessions/:id/stream — SSE endpoint for live PTY output
   */
  app.get<{ Params: { id: string } }>('/sessions/:id/stream', async (request, reply) => {
    const { id } = request.params;

    let session;
    try {
      session = pool.getSession(id);
    } catch {
      return reply.status(404).send({ error: `Session not found: ${id}` });
    }

    if (session.status === 'dead') {
      // Return final transcript for dead sessions
      return reply.status(400).send({
        error: 'Session is dead',
        final_transcript: session.transcript,
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial transcript burst (strip ANSI escapes for browser display)
    if (session.transcript) {
      const initialData = JSON.stringify({ text: stripAnsi(session.transcript), timestamp: new Date().toISOString() });
      reply.raw.write(`data: ${initialData}\n\n`);
    }

    // Subscribe to live output (strip ANSI escapes for browser display)
    const unsubscribe = session.onOutput((data: string) => {
      const payload = JSON.stringify({ text: stripAnsi(data), timestamp: new Date().toISOString() });
      reply.raw.write(`data: ${payload}\n\n`);
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  /**
   * GET /sessions/:id/live — Live output HTML page
   */
  app.get<{ Params: { id: string } }>('/sessions/:id/live', async (request, reply) => {
    const { id } = request.params;

    let statusInfo;
    try {
      statusInfo = pool.status(id);
    } catch {
      return reply.status(404).send({ error: `Session not found: ${id}` });
    }

    const usage = tokenTracker.getUsage(id);
    const methodSid = (statusInfo.metadata as Record<string, unknown> | undefined)?.methodology_session_id ?? null;
    const workdirShort = statusInfo.workdir.split(/[\\/]/).pop() ?? statusInfo.workdir;

    let html = loadTemplate();

    html = html.replace(/\{\{sessionId\}\}/g, escapeHtml(statusInfo.sessionId));
    html = html.replace(/\{\{nickname\}\}/g, escapeHtml(statusInfo.nickname));
    html = html.replace(/\{\{status\}\}/g, escapeHtml(statusInfo.status));
    html = html.replace(/\{\{statusClass\}\}/g, statusInfo.status);
    html = html.replace(/\{\{shortId\}\}/g, escapeHtml(statusInfo.sessionId.substring(0, 8)));
    html = html.replace(/\{\{uptime\}\}/g, formatTimeAgo(statusInfo.lastActivityAt));
    html = html.replace(/\{\{purpose\}\}/g, statusInfo.purpose ? escapeHtml(statusInfo.purpose) : '&mdash;');
    html = html.replace(/\{\{workdir\}\}/g, escapeHtml(workdirShort));
    html = html.replace(/\{\{methodSid\}\}/g, methodSid ? escapeHtml(String(methodSid)) : '&mdash;');
    html = html.replace(/\{\{tokens\}\}/g, usage ? formatTokens(usage.totalTokens) : '&mdash;');
    html = html.replace(/\{\{cache\}\}/g, usage ? `${Math.round(usage.cacheHitRate)}%` : '&mdash;');

    return reply.type('text/html').send(html);
  });
}
