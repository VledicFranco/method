import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import type { SessionPool, SessionChainInfo } from './pool.js';
import type { UsagePoller, SubscriptionUsage, UsageBucket, UsagePollerStatus } from './usage-poller.js';
import type { TokenTracker } from './token-tracker.js';
import { readMessages, type ChannelMessage } from './channels.js';
import type { SessionDiagnostics } from './diagnostics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let templateCache: string | null = null;

function loadTemplate(): string {
  if (!templateCache) {
    templateCache = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
  }
  return templateCache;
}

export function registerDashboardRoute(
  app: FastifyInstance,
  pool: SessionPool,
  usagePoller: UsagePoller,
  tokenTracker: TokenTracker,
  config: { port: number; startedAt: Date; version: string },
): void {
  app.get('/dashboard', async (_request, reply) => {
    const sessions = pool.list();
    const stats = pool.poolStats();
    const aggregate = tokenTracker.getAggregate();
    const subscriptionUsage = usagePoller.getCached();

    let html = loadTemplate();

    // Bridge placeholders
    html = html.replace(/\{\{bridge\.port\}\}/g, String(config.port));
    html = html.replace(/\{\{bridge\.startedAt\}\}/g, formatStartedAt(config.startedAt));
    html = html.replace(/\{\{bridge\.version\}\}/g, config.version);
    html = html.replace(/\{\{bridge\.activeSessions\}\}/g, String(stats.activeSessions));
    html = html.replace(/\{\{bridge\.maxSessions\}\}/g, String(stats.maxSessions));
    html = html.replace(/\{\{bridge\.totalSpawned\}\}/g, String(stats.totalSpawned));
    html = html.replace(/\{\{bridge\.uptime\}\}/g, formatUptime(config.startedAt));
    html = html.replace(/\{\{bridge\.deadSessions\}\}/g, String(stats.deadSessions));

    // Token placeholders
    html = html.replace(/\{\{tokens\.totalTokens\}\}/g, formatTokens(aggregate.totalTokens));
    html = html.replace(/\{\{tokens\.inputTokens\}\}/g, formatTokens(aggregate.inputTokens));
    html = html.replace(/\{\{tokens\.outputTokens\}\}/g, formatTokens(aggregate.outputTokens));
    html = html.replace(/\{\{tokens\.cacheHitRate\}\}/g, String(Math.round(aggregate.cacheHitRate)));
    html = html.replace(/\{\{tokens\.cacheReadTokens\}\}/g, formatTokens(aggregate.cacheReadTokens));

    // Subscription panel
    html = html.replace(/\{\{subscription\}\}/g, renderSubscriptionPanel(subscriptionUsage, usagePoller.getStatus()));

    // Session rows
    html = html.replace(/\{\{sessions\}\}/g, renderSessionRows(sessions, tokenTracker));

    // Channel data for each session (PRD 008)
    html = html.replace(/\{\{channels\}\}/g, renderChannelsPanel(sessions, pool));

    return reply.type('text/html').send(html);
  });
}

// ── Formatting Helpers ──────────────────────────────────────────

export function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUptime(startedAt: Date): string {
  const diffMs = Date.now() - startedAt.getTime();
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatStartedAt(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1_000);

  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTimeUntil(isoString: string): string {
  const target = new Date(isoString).getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';

  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function meterClass(utilization: number): string {
  if (utilization >= 85) return 'critical';
  if (utilization >= 60) return 'warning';
  return 'healthy';
}

function cacheRateClass(rate: number): string {
  if (rate >= 70) return 'good';
  if (rate >= 40) return 'mid';
  return 'low';
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ready': return 'status-ready';
    case 'working': return 'status-working';
    case 'waiting': return 'status-waiting';
    case 'dead': return 'status-dead';
    case 'initializing': return 'status-init';
    default: return 'status-init';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render Functions ────────────────────────────────────────────

function renderMeter(label: string, bucket: UsageBucket): string {
  const pct = Math.round(bucket.utilization);
  const cls = meterClass(pct);
  const resetDetail = bucket.resets_at
    ? `resets in ${formatTimeUntil(bucket.resets_at)}`
    : '';

  return `
      <div class="meter">
        <div class="meter-header">
          <span class="meter-label">${escapeHtml(label)}</span>
          <span class="meter-value ${cls}">${pct}%</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill ${cls}" style="width: ${pct}%;"></div>
        </div>
        <div class="meter-detail">${escapeHtml(resetDetail)}</div>
      </div>`;
}

export function renderSubscriptionPanel(usage: SubscriptionUsage | null, status: UsagePollerStatus): string {
  // Show status messages when usage data isn't available
  if (!usage) {
    const statusMessages: Record<string, { label: string; detail: string; color: string }> = {
      not_configured: {
        label: 'Not Configured',
        detail: 'Set CLAUDE_OAUTH_TOKEN or log in with <code>claude</code> to enable subscription meters',
        color: 'var(--muted)',
      },
      scope_error: {
        label: 'Scope Error (403)',
        detail: 'OAuth token is missing the <code>user:inference</code> scope — re-authenticate with <code>claude</code>',
        color: 'var(--red)',
      },
      network_error: {
        label: 'Network Error',
        detail: 'Cannot reach api.anthropic.com — will retry automatically',
        color: 'var(--solar)',
      },
      polling: {
        label: 'Loading...',
        detail: 'First poll in progress',
        color: 'var(--dim2)',
      },
    };

    const msg = statusMessages[status];
    if (!msg) return '';

    return `
  <div class="subscription-panel">
    <div class="subscription-header">
      <h2 class="subscription-title">Subscription Usage</h2>
      <div class="subscription-poll" style="color: ${msg.color};">
        <span class="dot" style="background: ${msg.color};"></span>
        ${msg.label}
      </div>
    </div>
    <div style="padding: .5rem 0; font-family: var(--font-m); font-size: .72rem; color: var(--dim2);">
      ${msg.detail}
    </div>
  </div>`;
  }

  const polledAt = new Date(usage.polled_at);
  const polledAgo = formatTimeAgo(polledAt);

  return `
  <div class="subscription-panel">
    <div class="subscription-header">
      <h2 class="subscription-title">Subscription Usage</h2>
      <div class="subscription-poll">
        <span class="dot"></span>
        Polled ${escapeHtml(polledAgo)} &middot; Claude Code Max
      </div>
    </div>

    <div class="meters-grid">
      ${renderMeter('5-Hour Window', usage.five_hour)}
      ${renderMeter('7-Day Ceiling', usage.seven_day)}
      ${renderMeter('7-Day Sonnet', usage.seven_day_sonnet)}
      ${renderMeter('7-Day Opus', usage.seven_day_opus)}
    </div>
  </div>`;
}

function renderChannelsPanel(
  sessions: Array<{
    sessionId: string;
    nickname: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>,
  pool: SessionPool,
): string {
  // Collect recent events across all sessions
  const allEvents: Array<{
    sessionId: string;
    shortId: string;
    message: ChannelMessage;
  }> = [];

  const progressTimelines: string[] = [];

  for (const session of sessions) {
    if (session.status === 'dead') continue;

    try {
      const channels = pool.getChannels(session.sessionId);
      const displayName = session.nickname;

      // Progress timeline for this session
      const progressResult = readMessages(channels.progress, 0);
      if (progressResult.messages.length > 0) {
        const recentProgress = progressResult.messages.slice(-8); // Last 8 entries
        const rows = recentProgress.map(msg => {
          const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const content = msg.content as Record<string, string>;
          const detail = content.description ?? content.step_name ?? content.step ?? '';
          return `
            <div class="progress-entry">
              <span class="progress-time">${escapeHtml(time)}</span>
              <span class="progress-type">${escapeHtml(msg.type)}</span>
              <span class="progress-detail">${escapeHtml(String(detail))}</span>
            </div>`;
        }).join('');

        progressTimelines.push(`
          <div class="progress-timeline">
            <div class="progress-timeline-header">
              <span class="mono session-id">${escapeHtml(displayName)}</span>
              <span class="progress-count">${progressResult.messages.length} entries</span>
            </div>
            ${rows}
          </div>`);
      }

      // Events for the global feed
      const eventsResult = readMessages(channels.events, 0);
      for (const msg of eventsResult.messages) {
        allEvents.push({ sessionId: session.sessionId, shortId: displayName, message: msg });
      }
    } catch {
      // Session may have been cleaned up
    }
  }

  // Sort events by timestamp descending, take last 20
  allEvents.sort((a, b) => b.message.timestamp.localeCompare(a.message.timestamp));
  const recentEvents = allEvents.slice(0, 20);

  // Build event feed
  const eventRows = recentEvents.length > 0
    ? recentEvents.map(e => {
        const time = new Date(e.message.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const iconClass = eventIconClass(e.message.type);
        return `
          <tr>
            <td class="mono timestamp">${escapeHtml(time)}</td>
            <td class="mono session-id">${escapeHtml(e.shortId)}</td>
            <td><span class="event-badge ${iconClass}">${escapeHtml(e.message.type)}</span></td>
            <td class="mono" style="color: var(--dim); font-size: .72rem;">${escapeHtml(summarizeEventContent(e.message.content))}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="text-align: center; color: var(--muted); padding: 1.5rem;">No events yet</td></tr>`;

  const progressSection = progressTimelines.length > 0
    ? progressTimelines.join('')
    : '<div style="color: var(--muted); padding: 1rem; font-size: .82rem;">No active progress</div>';

  return `
    <div class="channels-panel">
      <div class="channels-grid">
        <div class="channel-section">
          <div class="section-header">
            <h2 class="section-title">Progress</h2>
            <span class="section-tag">live methodology tracking</span>
          </div>
          ${progressSection}
        </div>
        <div class="channel-section">
          <div class="section-header">
            <h2 class="section-title">Event Feed</h2>
            <span class="section-tag">${recentEvents.length} recent events</span>
          </div>
          <table class="session-table" style="font-size: .8rem;">
            <thead>
              <tr>
                <th>Time</th>
                <th>Session</th>
                <th>Event</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${eventRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function eventIconClass(type: string): string {
  switch (type) {
    case 'completed': return 'event-completed';
    case 'error': return 'event-error';
    case 'escalation': return 'event-escalation';
    case 'budget_warning': return 'event-warning';
    case 'started': return 'event-started';
    case 'killed': return 'event-killed';
    case 'stale': return 'event-stale';
    default: return 'event-default';
  }
}

function summarizeEventContent(content: Record<string, unknown>): string {
  if (!content || Object.keys(content).length === 0) return '';
  // Try common fields
  if (content.result) return String(content.result).substring(0, 80);
  if (content.error_message) return String(content.error_message).substring(0, 80);
  if (content.escalation_question) return String(content.escalation_question).substring(0, 80);
  if (content.description) return String(content.description).substring(0, 80);
  // Fallback: first value
  const firstVal = Object.values(content)[0];
  return String(firstVal).substring(0, 60);
}

export function renderSessionRows(
  sessions: Array<{
    sessionId: string;
    nickname: string;
    purpose: string | null;
    status: string;
    queueDepth: number;
    metadata?: Record<string, unknown>;
    promptCount: number;
    lastActivityAt: Date;
    workdir: string;
    chain: SessionChainInfo;
    diagnostics: SessionDiagnostics | null;
  }>,
  tokenTracker: TokenTracker,
): string {
  if (sessions.length === 0) {
    return `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--muted); padding: 2rem;">
          No sessions. POST /sessions to spawn one.
        </td>
      </tr>`;
  }

  // Sort sessions into tree order: roots first, then children by depth
  const byId = new Map(sessions.map(s => [s.sessionId, s]));
  const ordered: typeof sessions = [];
  const visited = new Set<string>();

  function walk(sessionId: string): void {
    if (visited.has(sessionId)) return;
    visited.add(sessionId);
    const s = byId.get(sessionId);
    if (!s) return;
    ordered.push(s);
    for (const childId of s.chain.children) {
      walk(childId);
    }
  }

  // Start with roots (depth 0 or no parent)
  for (const s of sessions) {
    if (!s.chain.parent_session_id) {
      walk(s.sessionId);
    }
  }
  // Add any orphans not yet visited
  for (const s of sessions) {
    if (!visited.has(s.sessionId)) {
      ordered.push(s);
    }
  }

  return ordered
    .map((session) => {
      const shortId = session.sessionId.substring(0, 8);
      const badgeClass = statusBadgeClass(session.status);
      const usage = tokenTracker.getUsage(session.sessionId);
      const methodSid = (session.metadata as any)?.methodology_session_id ?? null;
      const workdirShort = session.workdir.split(/[\\/]/).pop() ?? session.workdir;
      const depth = session.chain.depth;
      const indent = depth > 0 ? `${'&nbsp;&nbsp;'.repeat(depth)}${'└─ '}` : '';

      let tokensCell: string;
      let cacheCell: string;

      if (usage) {
        tokensCell = `
          ${formatTokens(usage.totalTokens)}
          <div class="token-breakdown">in: ${formatTokens(usage.inputTokens)} &middot; out: ${formatTokens(usage.outputTokens)}</div>`;

        const rateClass = cacheRateClass(usage.cacheHitRate);
        cacheCell = `
          <span class="cache-rate ${rateClass}">${Math.round(usage.cacheHitRate)}%</span>
          <div class="token-breakdown">hits: ${formatTokens(usage.cacheReadTokens)}</div>`;
      } else {
        tokensCell = `<span style="color: var(--muted);">&mdash;</span>`;
        cacheCell = `<span style="color: var(--muted);">&mdash;</span>`;
      }

      const depthBadge = depth > 0
        ? `<span class="depth-badge">L${depth}</span>`
        : '';

      const rowId = `row-${shortId}`;
      const detailId = `detail-${shortId}`;

      // PRD 007: Expanded detail row content
      const purposeText = session.purpose ? escapeHtml(session.purpose) : '<span style="color:var(--muted);">&mdash;</span>';
      const spawnedTime = formatTimeAgo(session.lastActivityAt);
      const tokenDetail = usage
        ? `in: ${formatTokens(usage.inputTokens)} &middot; out: ${formatTokens(usage.outputTokens)} &middot; cache: ${Math.round(usage.cacheHitRate)}%`
        : '&mdash;';

      const liveLink = session.status !== 'dead'
        ? `<a href="/sessions/${escapeHtml(session.sessionId)}/live" class="detail-link">View Live Output</a>`
        : '';
      const transcriptLink = `<a href="/sessions/${escapeHtml(session.sessionId)}/transcript" class="detail-link">View Transcript</a>`;

      return `
      <tr id="${rowId}" class="session-row" onclick="toggleDetail('${detailId}')" style="cursor:pointer;">
        <td class="mono session-id">${indent}<span class="nickname">${escapeHtml(session.nickname)}</span></td>
        <td><span class="status ${badgeClass}">${escapeHtml(session.status)}</span></td>
        <td class="mono depth-cell" style="text-align:center">${depthBadge}</td>
        <td class="mono workdir">${escapeHtml(workdirShort)}</td>
        <td class="mono method-sid">${methodSid ? escapeHtml(methodSid) : '&mdash;'}</td>
        <td class="mono prompt-count" style="text-align:center">${session.promptCount}</td>
        <td class="mono tokens" style="text-align:right">${tokensCell}</td>
        <td class="mono" style="text-align:right">${cacheCell}</td>
        <td class="mono timestamp">${spawnedTime}</td>
      </tr>
      <tr id="${detailId}" class="detail-row" style="display:none;">
        <td colspan="9" class="detail-cell">
          <div class="detail-grid">
            <div class="detail-field">
              <span class="detail-label">Purpose</span>
              <span class="detail-value">${purposeText}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Full ID</span>
              <span class="detail-value mono" style="font-size:.68rem;color:var(--dim2);">${escapeHtml(session.sessionId)}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Workdir</span>
              <span class="detail-value mono">${escapeHtml(session.workdir)}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Method</span>
              <span class="detail-value mono method-sid">${methodSid ? escapeHtml(methodSid) : '&mdash;'}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Tokens</span>
              <span class="detail-value mono">${tokenDetail}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">First Output</span>
              <span class="detail-value mono">${session.diagnostics?.time_to_first_output_ms != null ? `${session.diagnostics.time_to_first_output_ms}ms` : '&mdash;'}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Tool Calls</span>
              <span class="detail-value mono">${session.diagnostics ? String(session.diagnostics.tool_call_count) : '&mdash;'}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Stall Reason</span>
              <span class="detail-value mono${session.diagnostics?.stall_reason ? ' stall-' + session.diagnostics.stall_reason : ''}">${session.diagnostics?.stall_reason ? escapeHtml(session.diagnostics.stall_reason.replace(/_/g, ' ')) : '&mdash;'}</span>
            </div>
          </div>
          <div class="detail-actions">
            ${liveLink}
            ${transcriptLink}
          </div>
        </td>
      </tr>`;
    })
    .join('\n');
}
