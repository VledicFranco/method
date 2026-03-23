/** Trigger domain types — pure HTTP consumer interfaces (PRD 019.4) */

export type TriggerType =
  | 'git_commit'
  | 'file_watch'
  | 'schedule'
  | 'webhook'
  | 'pty_watcher'
  | 'channel_event';

export interface TriggerStats {
  total_fires: number;
  last_fired_at: string | null;
  last_execution_id: string | null;
  debounced_events: number;
  errors: number;
}

export interface TriggerConfig {
  type: TriggerType;
  branch_pattern?: string;
  path_pattern?: string;
  paths?: string[];
  events?: string[];
  cron?: string;
  path?: string;
  secret_env?: string;
  filter?: string;
  methods?: string[];
  pattern?: string;
  condition?: string;
  event_types?: string[];
  debounce_ms?: number;
  debounce_strategy?: 'leading' | 'trailing';
  max_concurrent?: number;
  max_batch_size?: number;
}

export interface TriggerListItem {
  trigger_id: string;
  strategy_id: string;
  strategy_path: string;
  type: TriggerType;
  enabled: boolean;
  max_concurrent: number;
  active_executions: number;
  stats: TriggerStats;
  trigger_config: TriggerConfig;
}

export interface TriggerListResponse {
  triggers: TriggerListItem[];
  paused: boolean;
  total: number;
  watcher_count: number;
}

export interface TriggerFireEvent {
  trigger_type: TriggerType;
  strategy_id: string;
  trigger_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
  debounced_count: number;
}

export interface TriggerHistoryResponse {
  events: TriggerFireEvent[];
  count: number;
}

export interface TriggerDetailResponse extends TriggerListItem {
  recent_fires: TriggerFireEvent[];
}

export interface TriggerReloadResponse {
  added: string[];
  updated: string[];
  removed: string[];
  errors: Array<{ file: string; error: string }>;
  message: string;
}

export interface TriggerActionResponse {
  trigger_id?: string;
  enabled?: boolean;
  paused?: boolean;
  message: string;
}

export interface WebhookLogEntry {
  timestamp: string;
  method: string;
  hmac_status: 'pass' | 'fail' | 'none';
  filter_result: 'pass' | 'reject' | 'N/A';
  payload_preview: string;
  headers: Record<string, string>;
  payload_size_bytes: number;
}

export interface WebhookLogResponse {
  trigger_id: string;
  requests: WebhookLogEntry[];
  count: number;
}
