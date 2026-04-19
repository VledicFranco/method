// SPDX-License-Identifier: Apache-2.0
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
} from './utils.js';

// ── Formatting Helper Tests (utils.ts) ───────────────────────────

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

// Render function tests removed — dashboard-route.ts render functions
// replaced by frontend React components (BridgeHealthCards, TokenAggregateCards,
// SubscriptionMeters, SessionCard). Helper tests above now import from utils.ts.
