/** Bridge API response types — pure HTTP consumer, no imports from @method/* packages */

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

export interface PromptResponse {
  output: string;
  timed_out: boolean;
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

// ── Strategy Definition Types (PRD 019.3) ────────────────────

export interface StrategyNodeDef {
  id: string;
  type: 'methodology' | 'script';
  methodology?: string;
  method_hint?: string;
  depends_on: string[];
  inputs: string[];
  outputs: string[];
  gates: Array<{
    type: string;
    check: string;
    max_retries: number;
  }>;
}

export interface StrategyTriggerDef {
  type: string;
  config: Record<string, unknown>;
}

export interface StrategyGateDef {
  id: string;
  depends_on: string[];
  type: string;
  check: string;
}

export interface OversightRuleDef {
  condition: string;
  action: string;
}

export interface ContextInputDef {
  name: string;
  type: string;
  default?: unknown;
}

export interface StrategyOutputDef {
  type: string;
  target: string;
}

export interface StrategyLastExecution {
  execution_id: string;
  status: string;
  cost_usd: number;
  duration_ms: number;
  completed_at: string | null;
  started_at: string;
  gates_passed: number;
  gates_failed: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  file_path: string;
  triggers: StrategyTriggerDef[];
  nodes: StrategyNodeDef[];
  strategy_gates: StrategyGateDef[];
  oversight_rules: OversightRuleDef[];
  context_inputs: ContextInputDef[];
  outputs: StrategyOutputDef[];
  last_execution: StrategyLastExecution | null;
  raw_yaml: string;
  error?: string;
}

export interface StrategyDefinitionsResponse {
  definitions: StrategyDefinition[];
  error?: string;
}

export interface StrategyExecution {
  execution_id: string;
  strategy_id: string;
  strategy_name: string;
  status: string;
  started_at: string;
  cost_usd: number;
  retro_path: string | null;
}

export interface StrategyExecuteResponse {
  execution_id: string;
  status: string;
}
