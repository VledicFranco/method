// SPDX-License-Identifier: Apache-2.0
/**
 * Centralized Zod input schemas and shared schema helpers for MCP tools.
 *
 * Extracted from index.ts to reduce monolith size and enable reuse
 * across tool modules (methodology tools, bridge tools, etc.).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared property — used in tool schema definitions (ListToolsRequestSchema)
// ---------------------------------------------------------------------------

export const sessionIdProperty = {
  session_id: {
    type: "string" as const,
    description: "Session ID for multi-agent isolation. Omit for default shared session.",
  },
};

// ---------------------------------------------------------------------------
// Methodology tool input schemas
// ---------------------------------------------------------------------------

export const loadInput = z.object({
  methodology_id: z.string().describe("Methodology ID (e.g., P0-META)"),
  method_id: z.string().describe("Method ID (e.g., M1-MDES)"),
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

export const sessionInput = z.object({
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

export const theoryInput = z.object({
  term: z.string().describe("Term or concept to search for"),
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

// ---------------------------------------------------------------------------
// Bridge tool input schemas
// ---------------------------------------------------------------------------

const budgetSchema = z.object({
  max_depth: z.number().optional(),
  max_agents: z.number().optional(),
});

export const bridgeSpawnInput = z.object({
  workdir: z.string(),
  spawn_args: z.array(z.string()).optional(),
  initial_prompt: z.string().optional(),
  session_id: z.string().optional(),
  nickname: z.string().optional(),
  purpose: z.string().optional(),
  parent_session_id: z.string().optional(),
  depth: z.number().optional(),
  budget: budgetSchema.optional(),
  isolation: z.enum(["worktree", "shared"]).optional(),
  timeout_ms: z.number().optional(),
  mode: z.enum(["pty", "print"]).optional(),
  allowed_paths: z.array(z.string()).optional(),
  scope_mode: z.enum(["enforce", "warn"]).optional(),
  provider_type: z.enum(["print", "cognitive-agent"]).optional().describe("Session provider: 'print' for Claude CLI, 'cognitive-agent' for cognitive cycle engine"),
  cognitive_config: z.object({
    maxCycles: z.number().optional().describe("Max reasoning cycles (default: 15)"),
    maxToolsPerCycle: z.number().optional().describe("Max tool calls per cycle (default: 5)"),
    workspaceCapacity: z.number().optional().describe("Workspace entry capacity (default: 8)"),
    confidenceThreshold: z.number().optional().describe("Monitor intervention threshold (default: 0.3)"),
  }).optional().describe("Configuration overrides for cognitive-agent sessions"),
  llm_provider: z.enum(["anthropic", "ollama"]).optional().describe("LLM provider for cognitive-agent sessions"),
  llm_config: z.object({
    baseUrl: z.string().optional().describe("LLM API base URL (e.g. http://chobits:11434 for remote Ollama)"),
    model: z.string().optional().describe("Model name (e.g. qwen3:8b, claude-sonnet-4-6)"),
  }).optional().describe("LLM configuration for cognitive-agent sessions"),
  /** PRD 041: Route cognitive events to a specific experiment run's JSONL. */
  experiment_id: z.string().optional().describe("Experiment ID for cognitive-agent tracing — routes cognitive events to this experiment's JSONL file. Obtain from experiment_create."),
  run_id: z.string().optional().describe("Run ID for cognitive-agent tracing — routes cognitive events to this run's JSONL file. Obtain from experiment_run. Must be paired with experiment_id."),
});

export const bridgeSpawnBatchInput = z.object({
  sessions: z.array(z.object({
    workdir: z.string(),
    spawn_args: z.array(z.string()).optional(),
    initial_prompt: z.string().optional(),
    session_id: z.string().optional(),
    nickname: z.string().optional(),
    purpose: z.string().optional(),
    parent_session_id: z.string().optional(),
    depth: z.number().optional(),
    budget: budgetSchema.optional(),
    isolation: z.enum(["worktree", "shared"]).optional(),
    timeout_ms: z.number().optional(),
    mode: z.enum(["pty", "print"]).optional(),
    allowed_paths: z.array(z.string()).optional(),
    scope_mode: z.enum(["enforce", "warn"]).optional(),
  })),
  stagger_ms: z.number().optional(),
});

export const bridgePromptInput = z.object({
  bridge_session_id: z.string(),
  prompt: z.string(),
  timeout_ms: z.number().optional(),
});

export const bridgeKillInput = z.object({
  bridge_session_id: z.string(),
  worktree_action: z.enum(["merge", "keep", "discard"]).optional(),
});

export const bridgeProgressInput = z.object({
  bridge_session_id: z.string(),
  type: z.enum(["step_started", "step_completed", "working_on", "sub_agent_spawned"]),
  content: z.record(z.string(), z.unknown()).optional(),
});

export const bridgeEventInput = z.object({
  bridge_session_id: z.string(),
  type: z.enum(["completed", "error", "escalation", "budget_warning", "scope_violation", "stale"]),
  content: z.record(z.string(), z.unknown()).optional(),
});

export const bridgeReadChannelInput = z.object({
  bridge_session_id: z.string(),
  since_sequence: z.number().optional(),
});

export const bridgeAllEventsInput = z.object({
  since_sequence: z.number().optional(),
  filter_type: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Strategy & trigger input schemas
// ---------------------------------------------------------------------------

export const strategyExecuteInput = z.object({
  strategy_yaml: z.string().optional(),
  strategy_path: z.string().optional(),
  context_inputs: z.record(z.string(), z.unknown()).optional(),
});

export const strategyStatusInput = z.object({
  execution_id: z.string(),
});

export const strategyDryRunInput = z.object({
  nodes: z.array(z.object({
    node_id: z.string(),
    methodology_id: z.string(),
    model: z.string(),
    capabilities: z.array(z.string()).default([]),
    prompt_char_count: z.number().nonnegative().default(0),
  })).describe("DAG nodes to estimate"),
  edges: z.array(z.object({
    node_id: z.string(),
    depends_on: z.array(z.string()).default([]),
  })).describe("DAG edge list (node -> its dependencies)"),
});

export const strategyCreateInput = z.object({
  id: z.string().describe("Strategy ID (alphanumeric + hyphens, normalized to lowercase kebab-case)"),
  yaml: z.string().describe("Full strategy YAML content"),
});

export const strategyUpdateInput = z.object({
  strategy_id: z.string().describe("Strategy ID to update"),
  yaml: z.string().describe("Full replacement YAML content"),
});

export const strategyDeleteInput = z.object({
  strategy_id: z.string().describe("Strategy ID to delete"),
});

export const strategyExecutionStatusInput = z.object({
  execution_id: z.string().describe("Execution ID returned by strategy_execute"),
});

export const strategyResumeInput = z.object({
  execution_id: z.string().describe("Execution ID of a suspended strategy execution"),
  modified_inputs: z.record(z.string(), z.unknown()).optional().describe("Optional modified context inputs to use when resuming"),
});

export const strategyAbortInput = z.object({
  execution_id: z.string().describe("Execution ID of the strategy execution to abort"),
  reason: z.string().optional().describe("Reason for aborting the execution"),
});


export const triggerListInput = z.object({
  strategy_id: z.string().optional(),
});

export const triggerIdInput = z.object({
  trigger_id: z.string(),
});

// ---------------------------------------------------------------------------
// Resource copier input schemas
// ---------------------------------------------------------------------------

export const resourceCopyMethodologyInput = z.object({
  source_id: z.string(),
  method_name: z.string(),
  target_ids: z.array(z.string()),
});

export const resourceCopyStrategyInput = z.object({
  source_id: z.string(),
  strategy_name: z.string(),
  target_ids: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Genesis input schemas
// ---------------------------------------------------------------------------

export const projectIdInput = z.object({
  project_id: z.string(),
});

export const projectReadEventsInput = z.object({
  project_id: z.string().optional(),
  since_cursor: z.string().optional(),
});

export const genesisReportInput = z.object({
  message: z.string(),
});

// ---------------------------------------------------------------------------
// Experiment tool input schemas (PRD 041 Phase 3)
// ---------------------------------------------------------------------------

export const ExperimentCreateSchema = z.object({
  name: z.string().describe("Human-readable experiment name"),
  hypothesis: z.string().describe("The research hypothesis being tested"),
  conditions: z.array(z.object({
    name: z.string().describe("Human-readable condition name"),
    preset: z.string().optional().describe("Optional preset name to use as base configuration"),
    overrides: z.record(z.string(), z.unknown()).optional().describe("Module-level override parameters applied on top of the preset"),
    provider: z.object({
      type: z.string().describe("Provider type (e.g., 'anthropic', 'ollama')"),
      model: z.string().optional().describe("Model name"),
      baseUrl: z.string().optional().describe("Base URL for the provider API"),
    }).optional().describe("Provider configuration"),
    workspace: z.object({
      capacity: z.number().optional().describe("Workspace entry capacity"),
    }).optional().describe("Workspace configuration overrides"),
    cycle: z.object({
      maxCycles: z.number().optional().describe("Maximum cognitive cycles"),
      maxToolsPerCycle: z.number().optional().describe("Maximum tool calls per cycle"),
    }).optional().describe("Cycle control overrides"),
  })).describe("Named configurations under comparison"),
  tasks: z.array(z.string()).describe("Task prompts to run under each condition"),
});

export const ExperimentRunSchema = z.object({
  experimentId: z.string().describe("ID of the parent experiment"),
  conditionName: z.string().describe("Name of the condition to use for this run"),
  task: z.string().describe("Task prompt to execute"),
});

export const ExperimentResultsSchema = z.object({
  experimentId: z.string().describe("Experiment ID to retrieve results for"),
  runId: z.string().optional().describe("Optional: specific run ID to retrieve. Omit to list all runs."),
});

export const ExperimentCompareSchema = z.object({
  runIds: z.array(z.string()).min(2).describe("Two or more run IDs to compare"),
});

export const LabListPresetsSchema = z.object({});

export const LabDescribeModuleSchema = z.object({
  moduleId: z.string().describe("Module ID to describe (e.g., 'monitor', 'reason', 'act')"),
});

export const LabReadTracesSchema = z.object({
  experimentId: z.string().describe("Experiment ID"),
  runId: z.string().describe("Run ID to read traces for"),
  cycleNumber: z.number().optional().describe("Filter to a specific cycle number"),
  moduleId: z.string().optional().describe("Filter to a specific module ID"),
  phase: z.string().optional().describe("Filter to a specific execution phase"),
});

export const LabReadWorkspaceSchema = z.object({
  sessionId: z.string().describe("Bridge session ID to read workspace state for"),
});
