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
