// SPDX-License-Identifier: Apache-2.0
/**
 * BuildOrchestratorPact — Pacta pact definition for the orchestrator agent.
 *
 * Defines the contract for the cognitive agent that drives the 8-phase
 * build lifecycle. The agent uses existing MCP tools to drive strategies,
 * and Bash for validation. Budget constraints bound the blast radius.
 *
 * @see PRD 047 — Build Orchestrator §Surfaces
 */

/** Pact definition for the build orchestrator agent. */
export const buildOrchestratorPact = {
  name: "build-orchestrator",
  execution: { mode: "resumable" as const },
  budget: {
    maxTokens: 300_000,
    maxCostUsd: 5.0,
    maxDurationMs: 7_200_000,
  },
  scope: {
    allowedTools: [
      "strategy_execute",
      "strategy_status",
      "strategy_abort",
      "project_get",
      "project_list",
      "Read",
      "Glob",
      "Grep",
      "Bash",
    ] as const,
  },
  reasoning: { strategy: "react" as const },
} as const;
