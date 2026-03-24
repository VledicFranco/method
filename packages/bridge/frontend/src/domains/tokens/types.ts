/** Token & usage domain types — pure HTTP consumer interfaces */

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cacheHitRate: number;
}

export interface AggregateTokenUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  sessionCount: number;
}

export interface UsageBucket {
  utilization: number;
  resets_at: string | null;
}

export interface SubscriptionUsage {
  five_hour: UsageBucket;
  seven_day: UsageBucket;
  seven_day_sonnet: UsageBucket;
  seven_day_opus: UsageBucket;
  extra_usage: { enabled: boolean } | null;
  polled_at: string;
}

export type UsagePollerStatus =
  | 'not_configured'
  | 'polling'
  | 'scope_error'
  | 'network_error'
  | 'ok';

export interface UsageResponse {
  status: UsagePollerStatus;
  usage: SubscriptionUsage | null;
}
