// SPDX-License-Identifier: Apache-2.0
export type UsageBucket = {
  utilization: number;      // 0-100
  resets_at: string | null; // ISO timestamp
};

export type SubscriptionUsage = {
  five_hour: UsageBucket;
  seven_day: UsageBucket;
  seven_day_sonnet: UsageBucket;
  seven_day_opus: UsageBucket;
  extra_usage: { enabled: boolean } | null;
  polled_at: string;        // ISO timestamp of last successful poll
};

export type UsagePollerStatus =
  | 'not_configured'  // no token provided
  | 'polling'         // active and working
  | 'scope_error'     // 403 — token missing required scope
  | 'network_error'   // last poll failed, will retry
  | 'ok';             // has cached data

export type UsagePoller = {
  start(): void;
  stop(): void;
  getCached(): SubscriptionUsage | null;
  getStatus(): UsagePollerStatus;
};

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export function createUsagePoller(config: {
  oauthToken: string | null;
  pollIntervalMs: number;
}): UsagePoller {
  let cached: SubscriptionUsage | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let warned403 = false;
  let stopped = false;
  let lastNetworkError = false;

  async function poll(): Promise<void> {
    if (!config.oauthToken || stopped) return;

    try {
      const res = await fetch(USAGE_URL, {
        headers: {
          'Authorization': `Bearer ${config.oauthToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });

      if (res.status === 403) {
        if (!warned403) {
          console.warn('[usage-poller] 403 Forbidden — stopping subscription usage polling. Check CLAUDE_OAUTH_TOKEN.');
          warned403 = true;
        }
        stop();
        return;
      }

      if (!res.ok) {
        console.warn(`[usage-poller] HTTP ${res.status} — will retry on next interval`);
        return;
      }

      const body = await res.json() as Record<string, unknown>;

      cached = {
        five_hour: parseBucket(body, 'five_hour'),
        seven_day: parseBucket(body, 'seven_day'),
        seven_day_sonnet: parseBucket(body, 'seven_day_sonnet'),
        seven_day_opus: parseBucket(body, 'seven_day_opus'),
        extra_usage: parseExtraUsage(body),
        polled_at: new Date().toISOString(),
      };
      lastNetworkError = false;
    } catch (err) {
      lastNetworkError = true;
      console.warn(`[usage-poller] Network error — will retry on next interval:`, (err as Error).message);
    }
  }

  function stop(): void {
    stopped = true;
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return {
    start(): void {
      if (!config.oauthToken) return;
      stopped = false;

      // Immediate first poll (fire-and-forget)
      poll().catch(() => {});

      intervalHandle = setInterval(() => {
        poll().catch(() => {});
      }, config.pollIntervalMs);
    },

    stop,

    getCached(): SubscriptionUsage | null {
      return cached;
    },

    getStatus(): UsagePollerStatus {
      if (!config.oauthToken) return 'not_configured';
      if (warned403) return 'scope_error';
      if (lastNetworkError && !cached) return 'network_error';
      if (cached) return 'ok';
      return 'polling';
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────

export function parseBucket(body: Record<string, unknown>, key: string): UsageBucket {
  const bucket = body[key] as Record<string, unknown> | undefined;
  if (!bucket || typeof bucket !== 'object') {
    return { utilization: 0, resets_at: null };
  }

  const utilization = typeof bucket.utilization === 'number'
    ? bucket.utilization
    : typeof bucket.percent_used === 'number'
      ? bucket.percent_used
      : 0;

  const resets_at = typeof bucket.resets_at === 'string'
    ? bucket.resets_at
    : typeof bucket.reset_at === 'string'
      ? bucket.reset_at
      : null;

  return { utilization, resets_at };
}

export function parseExtraUsage(body: Record<string, unknown>): { enabled: boolean } | null {
  const extra = body.extra_usage as Record<string, unknown> | undefined;
  if (!extra || typeof extra !== 'object') return null;
  return { enabled: !!extra.enabled };
}
