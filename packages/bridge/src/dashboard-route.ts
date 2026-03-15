import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import type { SessionPool } from './pool.js';
import type { UsagePoller, SubscriptionUsage, UsageBucket, UsagePollerStatus } from './usage-poller.js';
import type { TokenTracker } from './token-tracker.js';

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

export function renderSessionRows(
  sessions: Array<{
    sessionId: string;
    status: string;
    queueDepth: number;
    metadata?: Record<string, unknown>;
    promptCount: number;
    lastActivityAt: Date;
    workdir: string;
  }>,
  tokenTracker: TokenTracker,
): string {
  if (sessions.length === 0) {
    return `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--muted); padding: 2rem;">
          No sessions. POST /sessions to spawn one.
        </td>
      </tr>`;
  }

  return sessions
    .map((session) => {
      const shortId = session.sessionId.substring(0, 8);
      const badgeClass = statusBadgeClass(session.status);
      const usage = tokenTracker.getUsage(session.sessionId);
      const methodSid = (session.metadata as any)?.methodology_session_id ?? null;
      const workdirShort = session.workdir.split(/[\\/]/).pop() ?? session.workdir;

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

      return `
      <tr>
        <td class="mono session-id">${escapeHtml(shortId)}</td>
        <td><span class="status ${badgeClass}">${escapeHtml(session.status)}</span></td>
        <td class="mono workdir">${escapeHtml(workdirShort)}</td>
        <td class="mono method-sid">${methodSid ? escapeHtml(methodSid) : '&mdash;'}</td>
        <td class="mono prompt-count" style="text-align:center">${session.promptCount}</td>
        <td class="mono tokens" style="text-align:right">${tokensCell}</td>
        <td class="mono" style="text-align:right">${cacheCell}</td>
        <td class="mono timestamp">${formatTimeAgo(session.lastActivityAt)}</td>
      </tr>`;
    })
    .join('\n');
}
