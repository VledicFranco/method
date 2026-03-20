/**
 * PRD 018: Event Triggers — Type Definitions (Phase 2a-1)
 *
 * Core types for the trigger system. Defines the TriggerWatcher interface,
 * TriggerEvent, TriggerRegistration, debounce configuration, and the
 * injectable timer interface used by tests.
 */

// ── Trigger Types ───────────────────────────────────────────────

export type TriggerType =
  | 'manual'
  | 'mcp_tool'
  | 'git_commit'
  | 'file_watch'
  | 'schedule'
  | 'webhook'
  | 'pty_watcher'
  | 'channel_event';

// ── Trigger Config (parsed from YAML) ───────────────────────────

export interface GitCommitTriggerConfig {
  type: 'git_commit';
  branch_pattern?: string;
  path_pattern?: string;
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface FileWatchTriggerConfig {
  type: 'file_watch';
  paths: string[];
  events?: Array<'create' | 'modify' | 'delete'>;
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface ScheduleTriggerConfig {
  type: 'schedule';
  cron: string;
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface PtyWatcherTriggerConfig {
  type: 'pty_watcher';
  pattern: string;
  condition?: string;
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface ChannelEventTriggerConfig {
  type: 'channel_event';
  event_types: string[];
  filter?: string;
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface ManualTriggerConfig {
  type: 'manual';
}

export interface McpToolTriggerConfig {
  type: 'mcp_tool';
  tool?: string;
}

export type TriggerConfig =
  | GitCommitTriggerConfig
  | FileWatchTriggerConfig
  | ScheduleTriggerConfig
  | PtyWatcherTriggerConfig
  | ChannelEventTriggerConfig
  | ManualTriggerConfig
  | McpToolTriggerConfig;

// ── TriggerWatcher Interface ────────────────────────────────────

export interface TriggerWatcher {
  /** Start watching. Calls onFire when the trigger condition is met. */
  start(onFire: (payload: Record<string, unknown>) => void): void;

  /** Stop watching. Releases all resources. */
  stop(): void;

  /** The trigger type this watcher handles */
  readonly type: TriggerType;

  /** Whether the watcher is currently active */
  readonly active: boolean;
}

// ── Trigger Event ───────────────────────────────────────────────

export interface TriggerEvent {
  trigger_type: TriggerType;
  strategy_id: string;
  trigger_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
  debounced_count: number;
}

// ── Trigger Registration ────────────────────────────────────────

export interface TriggerStats {
  total_fires: number;
  last_fired_at: string | null;
  last_execution_id: string | null;
  debounced_events: number;
  errors: number;
}

export interface TriggerRegistration {
  trigger_id: string;
  strategy_id: string;
  strategy_path: string;
  trigger_config: TriggerConfig;
  watcher: TriggerWatcher | null;
  enabled: boolean;
  max_concurrent: number;
  active_executions: number;
  stats: TriggerStats;
}

// ── Debounce Configuration ──────────────────────────────────────

export interface DebounceConfig {
  window_ms: number;
  strategy: 'leading' | 'trailing';
  max_batch_size: number;
}

export interface DebouncedEvent {
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface DebouncedTriggerFire {
  events: DebouncedEvent[];
  first_event_at: string;
  last_event_at: string;
  count: number;
}

// ── Injectable Timer Interface ──────────────────────────────────

export interface TimerInterface {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
  now: () => number;
}

/** Default timer using real Node.js timers */
export const realTimers: TimerInterface = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: () => Date.now(),
};
