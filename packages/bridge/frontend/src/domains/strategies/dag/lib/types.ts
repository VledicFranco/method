/** Strategy DAG visualization types — ported from viz/ for the Narrative Flow frontend */

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'gate_failed'
  | 'suspended';

export type ExecutionStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'suspended';

export interface MethodologyNodeConfig {
  type: 'methodology';
  methodology: string;
  method_hint?: string;
  capabilities: string[];
}

export interface ScriptNodeConfig {
  type: 'script';
  script: string;
}

export interface GateConfig {
  type: string;
  check: string;
  max_retries: number;
  timeout_ms: number;
}

export interface StrategyNode {
  id: string;
  type: 'methodology' | 'script';
  depends_on: string[];
  inputs: string[];
  outputs: string[];
  gates: GateConfig[];
  config: MethodologyNodeConfig | ScriptNodeConfig;
}

export interface StrategyGate {
  id: string;
  depends_on: string[];
  gate: GateConfig;
}

export interface StrategyDAG {
  id: string;
  name: string;
  version: string;
  nodes: StrategyNode[];
  strategy_gates: StrategyGate[];
  capabilities: Record<string, string[]>;
  oversight_rules: Array<{ condition: string; action: string }>;
  context_inputs: Array<{ name: string; type: string; default?: unknown }>;
}

export interface GateResult {
  gate_id: string;
  passed: boolean;
  check: string;
  result: unknown;
  error?: string;
  evaluated_at: string;
}

export interface NodeResult {
  status: NodeStatus;
  cost_usd: number;
  duration_ms: number;
  retries: number;
  error?: string;
  started_at?: string;
}

export interface ExecutionStatusResponse {
  execution_id: string;
  strategy_id: string;
  strategy_name: string;
  status: ExecutionStatus;
  started_at: string;
  cost_usd: number;
  node_statuses?: Record<string, string>;
  node_results?: Record<string, NodeResult>;
  gate_results?: GateResult[];
  completed_at?: string;
  duration_ms?: number;
  artifacts?: Record<string, unknown>;
  oversight_events?: Array<{
    rule: { condition: string; action: string };
    triggered_at: string;
    context: Record<string, unknown>;
  }>;
  retro_path?: string;
  error?: string;
}

export interface MethodologyNodeData {
  [key: string]: unknown;
  label: string;
  nodeType: 'methodology';
  methodology: string;
  method_hint?: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  gates: GateConfig[];
  status: NodeStatus;
  cost_usd?: number;
  duration_ms?: number;
  retries?: number;
  error?: string;
}

export interface ScriptNodeData {
  [key: string]: unknown;
  label: string;
  nodeType: 'script';
  script: string;
  inputs: string[];
  outputs: string[];
  status: NodeStatus;
  duration_ms?: number;
  error?: string;
}

export interface GateNodeData {
  [key: string]: unknown;
  label: string;
  nodeType: 'gate';
  gateId: string;
  check: string;
  depends_on: string[];
  status: 'pending' | 'passed' | 'failed';
  result?: unknown;
  error?: string;
}

export type VizNodeData = MethodologyNodeData | ScriptNodeData | GateNodeData;
