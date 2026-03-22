// ── PRD 010: PTY Activity Watcher ───────────────────────────────
// Per-session subscriber that detects structured activity patterns
// in PTY output and auto-emits to channels.

import {
  type ObservationCategory,
  type PatternMatch,
  ALL_MATCHERS,
  PROMPT_CHAR_RE,
  createScopeViolationMatcher,
} from './pattern-matchers.js';
import { appendMessage, type SessionChannels } from './channels.js';

/** PRD 012: Callback invoked for each observation (used by DiagnosticsTracker). */
export type ObservationCallback = (match: PatternMatch, isIdle: boolean) => void;

/** PRD 014: Callback for scope violation events that need push notification to parent. */
export type ScopeViolationCallback = (content: unknown) => void;

// ── ANSI stripping ──────────────────────────────────────────────

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;

export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ── Types ───────────────────────────────────────────────────────

export interface ActivityObservation {
  timestamp: string;
  category: ObservationCategory;
  detail: Record<string, unknown>;
}

export interface WatcherConfig {
  enabled: boolean;
  patterns: Set<ObservationCategory>;
  rateLimitMs: number;
  dedupWindowMs: number;
  autoRetro: boolean;
  logMatches: boolean;
}

export interface PtyWatcher {
  readonly sessionId: string;
  readonly observations: ActivityObservation[];
  readonly spawnedAt: Date;
  readonly config: WatcherConfig;
  detach(): void;
}

// ── Default Config ──────────────────────────────────────────────

const ALL_CATEGORIES: ObservationCategory[] = [
  'tool_call', 'git_commit', 'test_result', 'file_operation',
  'build_result', 'error', 'idle', 'permission_prompt',
  'scope_violation',  // PRD 014
];

export function parseWatcherConfig(env: Record<string, string | undefined>, metadata?: Record<string, unknown>): WatcherConfig {
  // Per-session override from metadata
  const perSession = metadata?.pty_watcher as
    | { enabled?: boolean; patterns?: string[]; auto_retro?: boolean }
    | undefined;

  const envEnabled = (env.PTY_WATCHER_ENABLED ?? 'true') !== 'false';
  const enabled = perSession?.enabled ?? envEnabled;

  let patterns: Set<ObservationCategory>;
  if (perSession?.patterns) {
    patterns = new Set(perSession.patterns as ObservationCategory[]);
  } else {
    const envPatterns = env.PTY_WATCHER_PATTERNS ?? 'all';
    if (envPatterns === 'all') {
      patterns = new Set(ALL_CATEGORIES);
    } else {
      patterns = new Set(envPatterns.split(',').map(s => s.trim()) as ObservationCategory[]);
    }
  }

  return {
    enabled,
    patterns,
    rateLimitMs: parseInt(env.PTY_WATCHER_RATE_LIMIT_MS ?? '5000', 10),
    dedupWindowMs: parseInt(env.PTY_WATCHER_DEDUP_WINDOW_MS ?? '10000', 10),
    autoRetro: perSession?.auto_retro ?? ((env.PTY_WATCHER_AUTO_RETRO ?? 'true') !== 'false'),
    logMatches: (env.PTY_WATCHER_LOG_MATCHES ?? 'false') === 'true',
  };
}

// ── Per-category rate limit overrides ───────────────────────────

const CATEGORY_RATE_OVERRIDES: Partial<Record<ObservationCategory, number>> = {
  file_operation: 10_000,  // 10s — high-frequency
};

const CATEGORY_DEDUP_OVERRIDES: Partial<Record<ObservationCategory, number>> = {
  error: 15_000,  // 15s — multi-line stack traces
};

// ── Watcher Factory ─────────────────────────────────────────────

export function createPtyWatcher(
  sessionId: string,
  channels: SessionChannels,
  onOutputSubscribe: (cb: (data: string) => void) => () => void,
  config: WatcherConfig,
  onObservation?: ObservationCallback,
  /** PRD 014: Glob patterns of files this session is allowed to modify. */
  allowedPaths?: string[],
  /** PRD 014: Callback to push-notify parent on scope violations (F-N-1 fix). */
  onScopeViolation?: ScopeViolationCallback,
): PtyWatcher {
  const observations: ActivityObservation[] = [];
  const spawnedAt = new Date();

  // PRD 014: Create scope violation matcher if allowed_paths is configured
  const scopeViolationMatcher = (allowedPaths && allowedPaths.length > 0)
    ? createScopeViolationMatcher(allowedPaths)
    : null;

  // Rate limiting: category → last emission timestamp
  const lastEmissionTime = new Map<string, number>();

  // Dedup: key → last emission timestamp
  const dedupWindow = new Map<string, number>();

  // Idle detection state
  let lastActivityTimestamp = 0;
  let isWorking = false;

  // Line buffer for cross-chunk patterns
  let lineBuffer = '';

  function shouldEmit(match: PatternMatch, now: number): boolean {
    // Rate limiting
    const rateMs = CATEGORY_RATE_OVERRIDES[match.category] ?? config.rateLimitMs;
    const lastEmit = lastEmissionTime.get(match.category) ?? 0;
    if (now - lastEmit < rateMs) return false;

    // Dedup
    const dedupKey = `${match.category}:${match.messageType}:${JSON.stringify(match.content)}`;
    const dedupMs = CATEGORY_DEDUP_OVERRIDES[match.category] ?? config.dedupWindowMs;
    const lastDedup = dedupWindow.get(dedupKey) ?? 0;
    if (now - lastDedup < dedupMs) return false;

    return true;
  }

  function recordEmission(match: PatternMatch, now: number): void {
    lastEmissionTime.set(match.category, now);
    const dedupKey = `${match.category}:${match.messageType}:${JSON.stringify(match.content)}`;
    dedupWindow.set(dedupKey, now);
  }

  function handleChunk(rawData: string): void {
    const cleaned = stripAnsiCodes(rawData);
    const text = lineBuffer + cleaned;

    // Split into lines; keep last incomplete line in buffer
    const lines = text.split('\n');
    lineBuffer = lines.pop() ?? '';
    const completeText = lines.join('\n');

    if (completeText.length === 0 && lineBuffer.length === 0) return;

    // The text to match against: complete lines plus context from the current buffer
    const matchText = completeText || lineBuffer;
    const now = Date.now();

    // Run all pattern matchers (except idle — handled separately)
    for (const { category, matcher } of ALL_MATCHERS) {
      if (!config.patterns.has(category)) continue;

      const results = matcher(matchText);
      for (const match of results) {
        // Always record the observation (even if rate-limited for emission)
        observations.push({
          timestamp: new Date(now).toISOString(),
          category: match.category,
          detail: match.content,
        });

        // PRD 012: Notify diagnostics tracker
        if (onObservation) {
          try { onObservation(match, false); } catch { /* callback errors are non-fatal */ }
        }

        // Update activity tracking for idle detection
        lastActivityTimestamp = now;
        isWorking = true;

        // Emit to channel (with rate limiting + dedup)
        if (shouldEmit(match, now)) {
          const channel = match.channelTarget === 'progress' ? channels.progress : channels.events;
          appendMessage(channel, 'pty-watcher', match.messageType, match.content);
          recordEmission(match, now);

          if (config.logMatches) {
            console.log(`[pty-watcher:${sessionId}] ${match.category}/${match.messageType}`, match.content);
          }
        }
      }
    }

    // PRD 014: Run scope violation matcher (context-aware, separate from ALL_MATCHERS)
    if (scopeViolationMatcher && config.patterns.has('scope_violation')) {
      const scopeResults = scopeViolationMatcher(matchText);
      for (const match of scopeResults) {
        observations.push({
          timestamp: new Date(now).toISOString(),
          category: match.category,
          detail: match.content,
        });

        if (onObservation) {
          try { onObservation(match, false); } catch { /* callback errors are non-fatal */ }
        }

        lastActivityTimestamp = now;
        isWorking = true;

        if (shouldEmit(match, now)) {
          appendMessage(channels.events, 'pty-watcher', match.messageType, match.content);
          recordEmission(match, now);

          // PRD 014 F-N-1 fix: Push-notify parent for scope violations
          if (onScopeViolation) {
            try { onScopeViolation(match.content); } catch { /* non-fatal */ }
          }

          if (config.logMatches) {
            console.log(`[pty-watcher:${sessionId}] ${match.category}/${match.messageType}`, match.content);
          }
        }
      }
    }

    // Idle detection (Pattern 6)
    if (config.patterns.has('idle') && PROMPT_CHAR_RE.test(matchText)) {
      if (isWorking && lastActivityTimestamp > 0) {
        const idleAfterSeconds = Math.round((now - lastActivityTimestamp) / 1000);
        const lastActivity = observations.length > 0
          ? observations[observations.length - 1].category
          : 'unknown';

        const idleObservation = {
          timestamp: new Date(now).toISOString(),
          category: 'idle' as ObservationCategory,
          detail: { idle_after_seconds: idleAfterSeconds, last_activity: lastActivity },
        };
        observations.push(idleObservation);

        // PRD 012: Notify diagnostics tracker of idle transition
        if (onObservation) {
          try {
            onObservation({
              category: 'idle',
              channelTarget: 'progress',
              messageType: 'idle',
              content: idleObservation.detail,
            }, true);
          } catch { /* callback errors are non-fatal */ }
        }

        // Rate-limit idle emissions
        const lastIdleEmit = lastEmissionTime.get('idle') ?? 0;
        if (now - lastIdleEmit >= config.rateLimitMs) {
          appendMessage(channels.progress, 'pty-watcher', 'idle', {
            idle_after_seconds: idleAfterSeconds,
            last_activity: lastActivity,
          });
          lastEmissionTime.set('idle', now);
        }

        isWorking = false;
      }
    }

    // Periodic dedup window cleanup (every 100 chunks)
    if (observations.length % 100 === 0) {
      const cutoff = now - Math.max(config.dedupWindowMs, 15_000);
      for (const [key, ts] of dedupWindow) {
        if (ts < cutoff) dedupWindow.delete(key);
      }
    }
  }

  // Subscribe to PTY output
  const unsubscribe = config.enabled ? onOutputSubscribe(handleChunk) : () => {};

  return {
    sessionId,
    observations,
    spawnedAt,
    config,
    detach() {
      unsubscribe();
      // Flush remaining line buffer
      if (lineBuffer.length > 0) {
        handleChunk('\n');
      }
    },
  };
}
