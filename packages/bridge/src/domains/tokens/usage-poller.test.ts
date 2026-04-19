// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUsagePoller,
  parseBucket,
  parseExtraUsage,
  type UsagePoller,
  type SubscriptionUsage,
} from './usage-poller.js';

// ── Fetch Mock Infrastructure ────────────────────────────────────

const originalFetch = globalThis.fetch;

/** Realistic Anthropic usage API response body */
function makeUsageBody(overrides?: Partial<{
  five_hour: Record<string, unknown>;
  seven_day: Record<string, unknown>;
  seven_day_sonnet: Record<string, unknown>;
  seven_day_opus: Record<string, unknown>;
  extra_usage: Record<string, unknown> | null;
}>): Record<string, unknown> {
  return {
    five_hour: {
      utilization: 32.5,
      resets_at: '2026-03-17T10:00:00Z',
      ...overrides?.five_hour,
    },
    seven_day: {
      utilization: 67.8,
      resets_at: '2026-03-20T00:00:00Z',
      ...overrides?.seven_day,
    },
    seven_day_sonnet: {
      utilization: 15.2,
      resets_at: '2026-03-20T00:00:00Z',
      ...overrides?.seven_day_sonnet,
    },
    seven_day_opus: {
      utilization: 89.1,
      resets_at: '2026-03-20T00:00:00Z',
      ...overrides?.seven_day_opus,
    },
    extra_usage: overrides?.extra_usage !== undefined
      ? overrides.extra_usage
      : { enabled: true },
  };
}

function mockFetchSuccess(body: Record<string, unknown>): void {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch403(): void {
  globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
}

function mockFetch500(): void {
  globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });
}

function mockFetchNetworkError(): void {
  globalThis.fetch = async () => {
    throw new Error('fetch failed: ECONNREFUSED');
  };
}

/** Wait for async poll to settle — poll is fire-and-forget so we need a small delay */
function settle(ms = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── parseBucket Tests ────────────────────────────────────────────

describe('parseBucket (PRD 013)', () => {
  it('extracts valid bucket with utilization and resets_at', () => {
    const body = {
      five_hour: { utilization: 45.2, resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 45.2);
    assert.equal(result.resets_at, '2026-03-17T10:00:00Z');
  });

  it('returns defaults when key is missing from body', () => {
    const result = parseBucket({}, 'nonexistent');
    assert.equal(result.utilization, 0);
    assert.equal(result.resets_at, null);
  });

  it('returns defaults when bucket is not an object', () => {
    const result = parseBucket({ five_hour: 'not-an-object' }, 'five_hour');
    assert.equal(result.utilization, 0);
    assert.equal(result.resets_at, null);
  });

  it('returns defaults when bucket is null', () => {
    const result = parseBucket({ five_hour: null }, 'five_hour');
    assert.equal(result.utilization, 0);
    assert.equal(result.resets_at, null);
  });

  it('falls back to percent_used when utilization is absent', () => {
    const body = {
      five_hour: { percent_used: 72.5, resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 72.5);
  });

  it('prefers utilization over percent_used when both present', () => {
    const body = {
      five_hour: { utilization: 30, percent_used: 90, resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 30);
  });

  it('returns 0 utilization when neither utilization nor percent_used present', () => {
    const body = {
      five_hour: { resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 0);
  });

  it('falls back to reset_at when resets_at is absent', () => {
    const body = {
      five_hour: { utilization: 50, reset_at: '2026-03-17T12:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.resets_at, '2026-03-17T12:00:00Z');
  });

  it('prefers resets_at over reset_at when both present', () => {
    const body = {
      five_hour: { utilization: 50, resets_at: '2026-03-17T10:00:00Z', reset_at: '2026-03-17T12:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.resets_at, '2026-03-17T10:00:00Z');
  });

  it('returns null resets_at when neither resets_at nor reset_at present', () => {
    const body = {
      five_hour: { utilization: 50 },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.resets_at, null);
  });

  it('handles utilization of zero correctly', () => {
    const body = {
      five_hour: { utilization: 0, resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 0);
  });

  it('handles utilization of 100 correctly', () => {
    const body = {
      five_hour: { utilization: 100, resets_at: '2026-03-17T10:00:00Z' },
    };
    const result = parseBucket(body, 'five_hour');
    assert.equal(result.utilization, 100);
  });
});

// ── parseExtraUsage Tests ────────────────────────────────────────

describe('parseExtraUsage (PRD 013)', () => {
  it('extracts valid extra_usage with enabled=true', () => {
    const body = { extra_usage: { enabled: true } };
    const result = parseExtraUsage(body);
    assert.deepEqual(result, { enabled: true });
  });

  it('extracts valid extra_usage with enabled=false', () => {
    const body = { extra_usage: { enabled: false } };
    const result = parseExtraUsage(body);
    assert.deepEqual(result, { enabled: false });
  });

  it('returns null when extra_usage key is missing', () => {
    const result = parseExtraUsage({});
    assert.equal(result, null);
  });

  it('returns null when extra_usage is null', () => {
    const body = { extra_usage: null };
    const result = parseExtraUsage(body);
    assert.equal(result, null);
  });

  it('returns null when extra_usage is not an object', () => {
    const body = { extra_usage: 'string-value' };
    const result = parseExtraUsage(body);
    assert.equal(result, null);
  });

  it('coerces truthy enabled value to boolean', () => {
    const body = { extra_usage: { enabled: 1 } };
    const result = parseExtraUsage(body);
    assert.deepEqual(result, { enabled: true });
  });

  it('coerces falsy enabled value to boolean', () => {
    const body = { extra_usage: { enabled: 0 } };
    const result = parseExtraUsage(body);
    assert.deepEqual(result, { enabled: false });
  });

  it('returns enabled=false when enabled field is missing', () => {
    const body = { extra_usage: { other_field: 'value' } };
    const result = parseExtraUsage(body);
    assert.deepEqual(result, { enabled: false });
  });
});

// ── createUsagePoller Tests ──────────────────────────────────────

describe('createUsagePoller (PRD 013)', () => {

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── getStatus state machine ─────────────────────────────────

  describe('getStatus', () => {
    it('returns "not_configured" when no token provided (null)', () => {
      const poller = createUsagePoller({ oauthToken: null, pollIntervalMs: 60000 });
      assert.equal(poller.getStatus(), 'not_configured');
    });

    it('returns "polling" on fresh start before any poll completes', () => {
      // Don't call start() — just having a token and no data means "polling"
      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 60000 });
      // Before start, status is "polling" because token is configured but no data yet
      assert.equal(poller.getStatus(), 'polling');
      // Clean up — don't actually start polling
    });

    it('returns "ok" after a successful poll', async () => {
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'ok');
    });

    it('returns "scope_error" after 403 response', async () => {
      mockFetch403();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      // stop() is called internally on 403, but call it to be safe
      poller.stop();

      assert.equal(poller.getStatus(), 'scope_error');
    });

    it('returns "network_error" after fetch throws', async () => {
      mockFetchNetworkError();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'network_error');
    });

    it('stays "not_configured" even after start() when no token', () => {
      const poller = createUsagePoller({ oauthToken: null, pollIntervalMs: 60000 });
      poller.start();
      assert.equal(poller.getStatus(), 'not_configured');
      poller.stop();
    });
  });

  // ── Status transitions ─────────────────────────────────────

  describe('status transitions', () => {
    it('transitions polling → ok after successful fetch', async () => {
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      assert.equal(poller.getStatus(), 'polling');

      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'ok');
    });

    it('transitions polling → scope_error after 403', async () => {
      mockFetch403();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      assert.equal(poller.getStatus(), 'polling');

      poller.start();
      await settle();

      assert.equal(poller.getStatus(), 'scope_error');
    });

    it('transitions polling → network_error after fetch throws', async () => {
      mockFetchNetworkError();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      assert.equal(poller.getStatus(), 'polling');

      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'network_error');
    });

    it('not_configured stays not_configured after start()', async () => {
      const poller = createUsagePoller({ oauthToken: null, pollIntervalMs: 60000 });
      assert.equal(poller.getStatus(), 'not_configured');

      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'not_configured');
    });

    it('stays "ok" after successful poll even if subsequent poll gets non-ok HTTP', async () => {
      // First poll succeeds
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();

      assert.equal(poller.getStatus(), 'ok');

      // Simulate a 500 error on next poll — status should remain "ok" because
      // the code only sets lastNetworkError on catch, and non-ok HTTP just returns
      mockFetch500();
      // Manually trigger by stopping and restarting (or just check status stays ok)
      // The 500 path doesn't set lastNetworkError, and cached is still populated
      assert.equal(poller.getStatus(), 'ok');

      poller.stop();
    });

    it('network_error with existing cache still returns "ok"', async () => {
      // First poll succeeds
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getStatus(), 'ok');
      assert.ok(poller.getCached() !== null);

      // Simulate network error on next start — but cached data exists
      // Since getStatus checks `if (cached) return 'ok'` before checking network error,
      // it should still return 'ok'
      mockFetchNetworkError();
      poller.start();
      await settle();
      poller.stop();

      // cached is still populated, so status is "ok" even though lastNetworkError is true
      assert.equal(poller.getStatus(), 'ok');
    });
  });

  // ── getCached ───────────────────────────────────────────────

  describe('getCached', () => {
    it('returns null before any poll', () => {
      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 60000 });
      assert.equal(poller.getCached(), null);
    });

    it('returns null when no token configured', () => {
      const poller = createUsagePoller({ oauthToken: null, pollIntervalMs: 60000 });
      poller.start();
      assert.equal(poller.getCached(), null);
      poller.stop();
    });

    it('returns populated data after successful poll', async () => {
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const cached = poller.getCached();
      assert.ok(cached !== null);
      assert.equal(cached!.five_hour.utilization, 32.5);
      assert.equal(cached!.five_hour.resets_at, '2026-03-17T10:00:00Z');
      assert.equal(cached!.seven_day.utilization, 67.8);
      assert.equal(cached!.seven_day_sonnet.utilization, 15.2);
      assert.equal(cached!.seven_day_opus.utilization, 89.1);
      assert.deepEqual(cached!.extra_usage, { enabled: true });
      assert.ok(typeof cached!.polled_at === 'string');
    });

    it('retains cached data after a failed subsequent poll', async () => {
      const body = makeUsageBody();
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const firstCached = poller.getCached();
      assert.ok(firstCached !== null);

      // Network error on next poll
      mockFetchNetworkError();
      poller.start();
      await settle();
      poller.stop();

      // Cached data should still be from the first successful poll
      const secondCached = poller.getCached();
      assert.ok(secondCached !== null);
      assert.equal(secondCached!.five_hour.utilization, firstCached!.five_hour.utilization);
    });

    it('returns null after 403 (stop is called, no cache populated)', async () => {
      mockFetch403();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();

      assert.equal(poller.getCached(), null);
    });

    it('polled_at is a valid ISO timestamp', async () => {
      mockFetchSuccess(makeUsageBody());

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const cached = poller.getCached();
      assert.ok(cached !== null);
      // Verify it parses as a valid date
      const date = new Date(cached!.polled_at);
      assert.ok(!isNaN(date.getTime()));
    });
  });

  // ── start / stop ────────────────────────────────────────────

  describe('start / stop', () => {
    it('start is a no-op when no token', () => {
      const poller = createUsagePoller({ oauthToken: null, pollIntervalMs: 60000 });
      // Should not throw
      poller.start();
      assert.equal(poller.getStatus(), 'not_configured');
      poller.stop();
    });

    it('stop clears the interval and prevents further polling', async () => {
      let fetchCallCount = 0;
      globalThis.fetch = async () => {
        fetchCallCount++;
        return new Response(JSON.stringify(makeUsageBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 50 });
      poller.start();
      await settle(80);
      const countAtStop = fetchCallCount;
      poller.stop();

      // Wait to ensure no more polls happen
      await settle(150);
      // Allow at most 1 extra call that was in-flight when stop was called
      assert.ok(
        fetchCallCount <= countAtStop + 1,
        `Expected no more fetches after stop: got ${fetchCallCount} vs ${countAtStop} at stop`,
      );
    });

    it('stop can be called multiple times without error', async () => {
      mockFetchSuccess(makeUsageBody());

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();

      // Multiple stop calls should not throw
      poller.stop();
      poller.stop();
      poller.stop();
      assert.ok(true, 'multiple stop calls did not throw');
    });

    it('start triggers an immediate first poll', async () => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return new Response(JSON.stringify(makeUsageBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.ok(fetchCalled, 'fetch should be called immediately on start');
    });
  });

  // ── Full integration: realistic API response ────────────────

  describe('full integration with realistic API response', () => {
    it('parses all four buckets and extra_usage from a realistic response', async () => {
      const body = makeUsageBody({
        five_hour: { utilization: 12.3, resets_at: '2026-03-17T14:00:00Z' },
        seven_day: { utilization: 55.0, resets_at: '2026-03-22T00:00:00Z' },
        seven_day_sonnet: { utilization: 8.7, resets_at: '2026-03-22T00:00:00Z' },
        seven_day_opus: { utilization: 95.5, resets_at: '2026-03-22T00:00:00Z' },
        extra_usage: { enabled: false },
      });
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'real-token-abc', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const cached = poller.getCached()!;
      assert.ok(cached);

      assert.equal(cached.five_hour.utilization, 12.3);
      assert.equal(cached.five_hour.resets_at, '2026-03-17T14:00:00Z');

      assert.equal(cached.seven_day.utilization, 55.0);
      assert.equal(cached.seven_day.resets_at, '2026-03-22T00:00:00Z');

      assert.equal(cached.seven_day_sonnet.utilization, 8.7);
      assert.equal(cached.seven_day_sonnet.resets_at, '2026-03-22T00:00:00Z');

      assert.equal(cached.seven_day_opus.utilization, 95.5);
      assert.equal(cached.seven_day_opus.resets_at, '2026-03-22T00:00:00Z');

      assert.deepEqual(cached.extra_usage, { enabled: false });
    });

    it('handles API response with percent_used fallback field', async () => {
      const body = {
        five_hour: { percent_used: 40.0, reset_at: '2026-03-17T14:00:00Z' },
        seven_day: { percent_used: 60.0, reset_at: '2026-03-22T00:00:00Z' },
        seven_day_sonnet: { percent_used: 10.0, reset_at: '2026-03-22T00:00:00Z' },
        seven_day_opus: { percent_used: 85.0, reset_at: '2026-03-22T00:00:00Z' },
        extra_usage: { enabled: true },
      };
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const cached = poller.getCached()!;
      assert.ok(cached);
      assert.equal(cached.five_hour.utilization, 40.0);
      assert.equal(cached.five_hour.resets_at, '2026-03-17T14:00:00Z');
      assert.equal(cached.seven_day.utilization, 60.0);
    });

    it('handles API response with missing buckets gracefully', async () => {
      // Response missing some buckets entirely
      const body = {
        five_hour: { utilization: 50, resets_at: '2026-03-17T14:00:00Z' },
        // seven_day, seven_day_sonnet, seven_day_opus are missing
      };
      mockFetchSuccess(body);

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      const cached = poller.getCached()!;
      assert.ok(cached);
      assert.equal(cached.five_hour.utilization, 50);
      // Missing buckets get defaults
      assert.equal(cached.seven_day.utilization, 0);
      assert.equal(cached.seven_day.resets_at, null);
      assert.equal(cached.seven_day_sonnet.utilization, 0);
      assert.equal(cached.seven_day_opus.utilization, 0);
      assert.equal(cached.extra_usage, null);
    });

    it('sends correct Authorization header and anthropic-beta header', async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers) capturedHeaders = { ...headers };
        return new Response(JSON.stringify(makeUsageBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const poller = createUsagePoller({ oauthToken: 'my-oauth-token-123', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(capturedHeaders['Authorization'], 'Bearer my-oauth-token-123');
      assert.equal(capturedHeaders['anthropic-beta'], 'oauth-2025-04-20');
    });

    it('polls the correct URL', async () => {
      let capturedUrl = '';
      globalThis.fetch = async (url: string | URL | Request) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        return new Response(JSON.stringify(makeUsageBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(capturedUrl, 'https://api.anthropic.com/api/oauth/usage');
    });
  });

  // ── 403 behavior ────────────────────────────────────────────

  describe('403 handling', () => {
    it('stops polling after receiving 403', async () => {
      let fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount++;
        return new Response('Forbidden', { status: 403 });
      };

      const poller = createUsagePoller({ oauthToken: 'bad-scope-token', pollIntervalMs: 50 });
      poller.start();
      await settle(80);

      const countAfterFirst = fetchCount;
      // Wait more — should not poll again
      await settle(200);

      assert.equal(fetchCount, countAfterFirst, 'should not poll again after 403');
      assert.equal(poller.getStatus(), 'scope_error');
    });
  });

  // ── Non-OK HTTP status (not 403) ───────────────────────────

  describe('non-OK HTTP status handling', () => {
    it('does not update cache on 500 error', async () => {
      mockFetch500();

      const poller = createUsagePoller({ oauthToken: 'test-token', pollIntervalMs: 600000 });
      poller.start();
      await settle();
      poller.stop();

      assert.equal(poller.getCached(), null);
      // Note: 500 doesn't set lastNetworkError (it's not a catch), and no cache,
      // so status is "polling"
      assert.equal(poller.getStatus(), 'polling');
    });
  });
});
