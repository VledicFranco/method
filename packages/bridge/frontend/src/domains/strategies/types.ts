/** Strategy domain types — pure HTTP consumer interfaces (PRD 019.3) */

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
