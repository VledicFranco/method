import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTokens,
  formatUptime,
  formatTimeAgo,
  formatStartedAt,
  formatTimeUntil,
  meterClass,
  cacheRateClass,
  statusBadgeClass,
  escapeHtml,
  summarizeEventContent,
  renderSubscriptionPanel,
  renderSessionRows,
} from '../dashboard-route.js';
import type { TokenTracker, SessionTokenUsage } from '../token-tracker.js';
import type { SessionChainInfo } from '../pool.js';
import type { SessionDiagnostics } from '../diagnostics.js';

// ── Test Doubles ─────────────────────────────────────────────────

function fakeTokenTracker(usages?: Map<string, SessionTokenUsage>): TokenTracker {
  const map = usages ?? new Map();
  return {
    registerSession: () => {},
    refreshUsage: () => null,
    getUsage: (id: string) => map.get(id) ?? null,
    getAggregate: () => ({
      totalTokens: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0, sessionCount: 0,
    }),
  };
}

function makeSession(overrides?: Partial<{
  sessionId: string;
  nickname: string;
  purpose: string | null;
  status: string;
  queueDepth: number;
  metadata: Record<string, unknown>;
  promptCount: number;
  lastActivityAt: Date;
  workdir: string;
  chain: SessionChainInfo;
  diagnostics: SessionDiagnostics | null;
}>) {
  return {
    sessionId: 'sess-00000001-0000-0000-0000-000000000001',
    nickname: 'impl-1',
    purpose: null,
    status: 'ready',
    queueDepth: 0,
    metadata: {},
    promptCount: 0,
    lastActivityAt: new Date(),
    workdir: '/home/user/project',
    chain: {
      parent_session_id: null,
      depth: 0,
      children: [],
      budget: { max_depth: 3, max_agents: 5, agents_spawned: 0 },
    },
    diagnostics: null,
    ...overrides,
  };
}

// ── Formatting Helper Tests ──────────────────────────────────────

describe('Dashboard Formatting Helpers (PRD 013)', () => {

  // ── formatTokens ────────────────────────────────────────────

  describe('formatTokens', () => {
    it('returns "0" for zero', () => {
      assert.equal(formatTokens(0), '0');
    });

    it('returns raw number below 1000', () => {
      assert.equal(formatTokens(1), '1');
      assert.equal(formatTokens(999), '999');
    });

    it('formats thousands with k suffix', () => {
      assert.equal(formatTokens(1000), '1.0k');
      assert.equal(formatTokens(1500), '1.5k');
      assert.equal(formatTokens(999999), '1000.0k');
    });

    it('formats millions with M suffix', () => {
      assert.equal(formatTokens(1000000), '1.0M');
      assert.equal(formatTokens(1500000), '1.5M');
      assert.equal(formatTokens(2750000), '2.8M');
    });
  });

  // ── formatUptime ────────────────────────────────────────────

  describe('formatUptime', () => {
    it('shows minutes only when under 1 hour', () => {
      const startedAt = new Date(Date.now() - 45 * 60_000);
      assert.equal(formatUptime(startedAt), '45m');
    });

    it('shows 0m for just started', () => {
      const startedAt = new Date(Date.now() - 10_000); // 10 seconds
      assert.equal(formatUptime(startedAt), '0m');
    });

    it('shows hours and minutes', () => {
      const startedAt = new Date(Date.now() - (2 * 60 + 15) * 60_000);
      assert.equal(formatUptime(startedAt), '2h 15m');
    });

    it('shows 1h 0m for exactly one hour', () => {
      const startedAt = new Date(Date.now() - 60 * 60_000);
      assert.equal(formatUptime(startedAt), '1h 0m');
    });
  });

  // ── formatStartedAt ─────────────────────────────────────────

  describe('formatStartedAt', () => {
    it('formats date as YYYY-MM-DD HH:MM:SS', () => {
      const date = new Date(2026, 2, 15, 14, 30, 45); // March 15, 2026
      assert.equal(formatStartedAt(date), '2026-03-15 14:30:45');
    });

    it('pads single-digit values with zeros', () => {
      const date = new Date(2026, 0, 5, 8, 3, 9); // Jan 5
      assert.equal(formatStartedAt(date), '2026-01-05 08:03:09');
    });
  });

  // ── formatTimeAgo ───────────────────────────────────────────

  describe('formatTimeAgo', () => {
    it('returns "now" for less than 5 seconds', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 2000)), 'now');
    });

    it('returns seconds ago for < 60s', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 30_000)), '30s ago');
    });

    it('returns minutes ago for < 60m', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 5 * 60_000)), '5m ago');
    });

    it('returns hours ago for >= 60m', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 2 * 60 * 60_000)), '2h ago');
    });

    it('boundary: 59s shows seconds', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 59_000)), '59s ago');
    });

    it('boundary: 60s shows 1m', () => {
      assert.equal(formatTimeAgo(new Date(Date.now() - 60_000)), '1m ago');
    });
  });

  // ── formatTimeUntil ─────────────────────────────────────────

  describe('formatTimeUntil', () => {
    it('returns "now" for past timestamps', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      assert.equal(formatTimeUntil(past), 'now');
    });

    it('returns minutes for < 1 hour', () => {
      const future = new Date(Date.now() + 30 * 60_000).toISOString();
      assert.equal(formatTimeUntil(future), '30m');
    });

    it('returns hours and minutes for < 24 hours', () => {
      const future = new Date(Date.now() + (2 * 60 + 30) * 60_000).toISOString();
      assert.equal(formatTimeUntil(future), '2h 30m');
    });

    it('returns days and hours for >= 24 hours', () => {
      const future = new Date(Date.now() + (26 * 60) * 60_000).toISOString();
      assert.equal(formatTimeUntil(future), '1d 2h');
    });
  });

  // ── meterClass ──────────────────────────────────────────────

  describe('meterClass', () => {
    it('returns "healthy" below 60', () => {
      assert.equal(meterClass(0), 'healthy');
      assert.equal(meterClass(59), 'healthy');
    });

    it('returns "warning" at 60-84', () => {
      assert.equal(meterClass(60), 'warning');
      assert.equal(meterClass(84), 'warning');
    });

    it('returns "critical" at 85+', () => {
      assert.equal(meterClass(85), 'critical');
      assert.equal(meterClass(100), 'critical');
    });
  });

  // ── cacheRateClass ──────────────────────────────────────────

  describe('cacheRateClass', () => {
    it('returns "low" below 40', () => {
      assert.equal(cacheRateClass(0), 'low');
      assert.equal(cacheRateClass(39), 'low');
    });

    it('returns "mid" at 40-69', () => {
      assert.equal(cacheRateClass(40), 'mid');
      assert.equal(cacheRateClass(69), 'mid');
    });

    it('returns "good" at 70+', () => {
      assert.equal(cacheRateClass(70), 'good');
      assert.equal(cacheRateClass(100), 'good');
    });
  });

  // ── statusBadgeClass ────────────────────────────────────────

  describe('statusBadgeClass', () => {
    it('maps known statuses', () => {
      assert.equal(statusBadgeClass('ready'), 'status-ready');
      assert.equal(statusBadgeClass('working'), 'status-working');
      assert.equal(statusBadgeClass('waiting'), 'status-waiting');
      assert.equal(statusBadgeClass('dead'), 'status-dead');
      assert.equal(statusBadgeClass('initializing'), 'status-init');
    });

    it('defaults to status-init for unknown status', () => {
      assert.equal(statusBadgeClass('unknown'), 'status-init');
    });
  });

  // ── escapeHtml ──────────────────────────────────────────────

  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      assert.equal(escapeHtml('a & b'), 'a &amp; b');
    });

    it('escapes less-than', () => {
      assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    });

    it('escapes greater-than', () => {
      assert.equal(escapeHtml('a > b'), 'a &gt; b');
    });

    it('escapes double quotes', () => {
      assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
    });

    it('escapes all special characters together', () => {
      assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
    });

    it('returns empty string unchanged', () => {
      assert.equal(escapeHtml(''), '');
    });

    it('returns plain text unchanged', () => {
      assert.equal(escapeHtml('hello world'), 'hello world');
    });
  });

  // ── summarizeEventContent ───────────────────────────────────

  describe('summarizeEventContent', () => {
    it('returns empty string for empty content', () => {
      assert.equal(summarizeEventContent({}), '');
    });

    it('returns empty string for null/undefined', () => {
      assert.equal(summarizeEventContent(null as any), '');
    });

    it('extracts result field', () => {
      assert.equal(summarizeEventContent({ result: 'Task completed successfully' }), 'Task completed successfully');
    });

    it('extracts error_message field', () => {
      assert.equal(summarizeEventContent({ error_message: 'Something went wrong' }), 'Something went wrong');
    });

    it('extracts escalation_question field', () => {
      assert.equal(summarizeEventContent({ escalation_question: 'Should I proceed?' }), 'Should I proceed?');
    });

    it('extracts description field', () => {
      assert.equal(summarizeEventContent({ description: 'Running tests' }), 'Running tests');
    });

    it('truncates long values at 80 chars', () => {
      const long = 'x'.repeat(100);
      assert.equal(summarizeEventContent({ result: long }).length, 80);
    });

    it('falls back to first value for unknown fields', () => {
      assert.equal(summarizeEventContent({ custom_field: 'some value' }), 'some value');
    });

    it('truncates fallback values at 60 chars', () => {
      const long = 'y'.repeat(100);
      assert.equal(summarizeEventContent({ custom: long }).length, 60);
    });

    it('prefers result over other fields', () => {
      assert.equal(
        summarizeEventContent({ result: 'win', error_message: 'lose' }),
        'win',
      );
    });
  });
});

// ── Render Function Tests ────────────────────────────────────────

describe('Dashboard Render Functions (PRD 013)', () => {

  // ── renderSubscriptionPanel ─────────────────────────────────

  describe('renderSubscriptionPanel', () => {
    it('shows not_configured message when no token', () => {
      const html = renderSubscriptionPanel(null, 'not_configured');
      assert.ok(html.includes('Not Configured'));
      assert.ok(html.includes('CLAUDE_OAUTH_TOKEN'));
    });

    it('shows scope_error message on 403', () => {
      const html = renderSubscriptionPanel(null, 'scope_error');
      assert.ok(html.includes('Scope Error (403)'));
      assert.ok(html.includes('user:inference'));
    });

    it('shows network_error message', () => {
      const html = renderSubscriptionPanel(null, 'network_error');
      assert.ok(html.includes('Network Error'));
      assert.ok(html.includes('retry'));
    });

    it('shows loading message during polling', () => {
      const html = renderSubscriptionPanel(null, 'polling');
      assert.ok(html.includes('Loading...'));
    });

    it('returns empty string for unknown status without usage', () => {
      const html = renderSubscriptionPanel(null, 'ok');
      assert.equal(html, '');
    });

    it('renders usage meters when data is available', () => {
      const usage = {
        five_hour: { utilization: 45, resets_at: null },
        seven_day: { utilization: 72, resets_at: null },
        seven_day_sonnet: { utilization: 30, resets_at: null },
        seven_day_opus: { utilization: 88, resets_at: null },
        extra_usage: null,
        polled_at: new Date().toISOString(),
      };
      const html = renderSubscriptionPanel(usage, 'ok');
      assert.ok(html.includes('5-Hour Window'));
      assert.ok(html.includes('7-Day Ceiling'));
      assert.ok(html.includes('7-Day Sonnet'));
      assert.ok(html.includes('7-Day Opus'));
      assert.ok(html.includes('meters-grid'));
      assert.ok(html.includes('Claude Code Max'));
    });

    it('applies correct meter classes based on utilization', () => {
      const usage = {
        five_hour: { utilization: 45, resets_at: null },      // healthy
        seven_day: { utilization: 72, resets_at: null },       // warning
        seven_day_sonnet: { utilization: 30, resets_at: null }, // healthy
        seven_day_opus: { utilization: 88, resets_at: null },   // critical
        extra_usage: null,
        polled_at: new Date().toISOString(),
      };
      const html = renderSubscriptionPanel(usage, 'ok');
      assert.ok(html.includes('healthy'));
      assert.ok(html.includes('warning'));
      assert.ok(html.includes('critical'));
    });
  });

  // ── renderSessionRows ───────────────────────────────────────

  describe('renderSessionRows', () => {
    it('shows empty message when no sessions', () => {
      const html = renderSessionRows([], fakeTokenTracker());
      assert.ok(html.includes('No sessions'));
      assert.ok(html.includes('POST /sessions'));
    });

    it('renders a single session row', () => {
      const session = makeSession({
        nickname: 'test-session',
        status: 'ready',
        promptCount: 3,
      });
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('test-session'));
      assert.ok(html.includes('status-ready'));
      assert.ok(html.includes('>3</td>'));
    });

    it('shows token data when available', () => {
      const session = makeSession({ sessionId: 'sid-001' });
      const usage: SessionTokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 800,
        cacheWriteTokens: 50,
        totalTokens: 2350,
        cacheHitRate: 44.4,
      };
      const tracker = fakeTokenTracker(new Map([['sid-001', usage]]));
      const html = renderSessionRows([session], tracker);
      assert.ok(html.includes('2.4k'));   // totalTokens formatted
      assert.ok(html.includes('1.0k'));   // inputTokens
      assert.ok(html.includes('44%'));    // cache hit rate
    });

    it('shows dash when no token data', () => {
      const session = makeSession();
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('&mdash;'));
    });

    it('renders depth badge for child sessions', () => {
      const parent = makeSession({
        sessionId: 'parent-001',
        nickname: 'parent',
        chain: {
          parent_session_id: null, depth: 0,
          children: ['child-001'],
          budget: { max_depth: 3, max_agents: 5, agents_spawned: 1 },
        },
      });
      const child = makeSession({
        sessionId: 'child-001',
        nickname: 'child',
        chain: {
          parent_session_id: 'parent-001', depth: 1,
          children: [],
          budget: { max_depth: 3, max_agents: 5, agents_spawned: 0 },
        },
      });

      const html = renderSessionRows([parent, child], fakeTokenTracker());
      assert.ok(html.includes('depth-badge'));
      assert.ok(html.includes('L1'));
    });

    it('orders sessions as tree: parents before children', () => {
      const child = makeSession({
        sessionId: 'child-001',
        nickname: 'child',
        chain: {
          parent_session_id: 'parent-001', depth: 1,
          children: [],
          budget: { max_depth: 3, max_agents: 5, agents_spawned: 0 },
        },
      });
      const parent = makeSession({
        sessionId: 'parent-001',
        nickname: 'parent',
        chain: {
          parent_session_id: null, depth: 0,
          children: ['child-001'],
          budget: { max_depth: 3, max_agents: 5, agents_spawned: 1 },
        },
      });

      // Pass child first — should still render parent first
      const html = renderSessionRows([child, parent], fakeTokenTracker());
      const parentIdx = html.indexOf('parent');
      const childIdx = html.indexOf('child');
      assert.ok(parentIdx < childIdx, 'parent should appear before child in output');
    });

    it('shows methodology session ID when present', () => {
      const session = makeSession({
        metadata: { methodology_session_id: 'S3-IMPL' },
      });
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('S3-IMPL'));
    });

    it('shows workdir short name', () => {
      const session = makeSession({ workdir: '/home/user/my-project' });
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('my-project'));
    });

    it('includes detail row with diagnostics', () => {
      const session = makeSession({
        diagnostics: {
          time_to_first_output_ms: 1500,
          time_to_first_tool_ms: 3000,
          tool_call_count: 12,
          total_settle_overhead_ms: 500,
          false_positive_settles: 0,
          current_settle_delay_ms: 1000,
          idle_transitions: 2,
          longest_idle_ms: 30000,
          permission_prompt_detected: false,
          stall_reason: null,
        },
      });
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('1500ms'));
      assert.ok(html.includes('12'));     // tool_call_count
    });

    it('shows stall reason when present', () => {
      const session = makeSession({
        diagnostics: {
          time_to_first_output_ms: null,
          time_to_first_tool_ms: null,
          tool_call_count: 0,
          total_settle_overhead_ms: 0,
          false_positive_settles: 0,
          current_settle_delay_ms: 1000,
          idle_transitions: 0,
          longest_idle_ms: 0,
          permission_prompt_detected: true,
          stall_reason: 'permission_blocked',
        },
      });
      const html = renderSessionRows([session], fakeTokenTracker());
      assert.ok(html.includes('permission blocked'));
    });
  });
});
