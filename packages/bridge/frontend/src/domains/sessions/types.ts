/** Session domain types — pure HTTP consumer interfaces */

export interface SessionSummary {
  session_id: string;
  nickname: string;
  purpose: string | null;
  status: string;
  mode: 'pty' | 'print';
  queue_depth: number;
  metadata: Record<string, unknown>;
  prompt_count: number;
  last_activity_at: string;
  workdir: string;
  parent_session_id: string | null;
  depth: number;
  children: string[];
  budget: {
    max_depth: number;
    max_agents: number;
    agents_spawned: number;
  };
  isolation: string;
  worktree_path: string | null;
  metals_available: boolean;
  stale: boolean;
}

export interface SessionDetail extends SessionSummary {
  diagnostics?: {
    last_tool?: string;
    last_tool_at?: string;
    git_commits?: number;
    tests_passed?: number;
    tests_failed?: number;
    errors_seen?: number;
  };
}

export interface SpawnRequest {
  workdir: string;
  initial_prompt?: string;
  spawn_args?: string[];
  metadata?: Record<string, unknown>;
  parent_session_id?: string;
  depth?: number;
  budget?: { max_depth?: number; max_agents?: number; agents_spawned?: number };
  isolation?: 'worktree' | 'shared';
  timeout_ms?: number;
  nickname?: string;
  purpose?: string;
  mode?: 'pty' | 'print';
}

export interface SpawnResponse {
  session_id: string;
  nickname: string;
  status: string;
  mode: string;
  depth: number;
  parent_session_id: string | null;
  budget: { max_depth: number; max_agents: number; agents_spawned: number };
  isolation: string;
  worktree_path: string | null;
  metals_available: boolean;
}

export interface PromptMetadata {
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  stop_reason: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export type ChatTurn =
  | {
      kind: 'historical';
      prompt: string;
      output: string;
      timestamp: string;
    }
  | {
      kind: 'live';
      prompt: string;
      output: string;
      metadata: PromptMetadata;
      timestamp: string;
    }
  | {
      kind: 'pending';
      prompt: string;
    };

export interface PromptResult {
  output: string;
  timed_out: boolean;
  metadata: PromptMetadata | null;
}

export interface PromptResponse {
  output: string;
  timed_out: boolean;
  metadata: PromptMetadata | null;
}

export interface HealthResponse {
  status: string;
  active_sessions: number;
  max_sessions: number;
  uptime_ms: number;
  version: string;
}

export interface PoolStatsResponse {
  max_sessions: number;
  active_count: number;
  dead_count: number;
  total_spawned: number;
  uptime_ms: number;
}

export interface ChannelMessage {
  sequence: number;
  sender: string;
  type: string;
  content: Record<string, unknown>;
  timestamp: string;
}

export interface ChannelReadResponse {
  messages: ChannelMessage[];
  last_sequence: number;
}

export interface AggregatedEvent {
  bridge_session_id: string;
  session_metadata: Record<string, unknown>;
  message: ChannelMessage;
}

export interface AggregatedEventsResponse {
  events: AggregatedEvent[];
  last_sequence: number;
}

export interface ApiError {
  error: string;
  status: number;
}
