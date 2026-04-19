// SPDX-License-Identifier: Apache-2.0
/**
 * Prebuilt strategy controllers — common decision patterns.
 *
 * - automatedController: run methodology, retry on failure, accept on success
 * - interactiveController: placeholder for human-in-the-loop strategies
 *
 * @see PRD 021 — Prebuilt strategy controllers
 */

import { Effect } from "effect";
import type { StrategyController, StrategyDecision } from "./controller.js";
import type { Methodology, SafetyBounds } from "../methodology/methodology.js";
import type { Gate } from "../gate/gate.js";

/** Default safety bounds used when no overrides are provided. */
const DEFAULT_SAFETY: SafetyBounds = {
  maxLoops: 3,
  maxTokens: 500_000,
  maxCostUsd: 10,
  maxDurationMs: 3_600_000,
  maxDepth: 3,
};

/**
 * Fully automated controller: run methodology, retry on failure, accept on completion.
 *
 * Decision logic:
 * - If methodology completes → done
 * - Otherwise → rerun (up to safety bounds)
 *
 * @param methodology - The methodology to execute
 * @param gates - Strategy-level quality gates evaluated after each run
 * @param safety - Optional safety bounds overrides (merged with defaults)
 * @returns A StrategyController with automated retry-on-failure logic
 */
export function automatedController<S>(
  methodology: Methodology<S>,
  gates: Gate<S>[],
  safety?: Partial<SafetyBounds>,
): StrategyController<S> {
  return {
    id: "auto",
    name: "Automated Controller",
    methodology,
    gates,
    onComplete: (result) => {
      if (result.status === "completed") {
        return Effect.succeed({ tag: "done", result } as StrategyDecision<S>);
      }
      return Effect.succeed({ tag: "rerun" } as StrategyDecision<S>);
    },
    safety: { ...DEFAULT_SAFETY, ...safety },
  };
}

/**
 * Interactive controller: always yields to the caller after each run.
 *
 * Decision logic:
 * - Always returns "done" — the caller inspects the result and decides
 *   whether to create a new strategy run externally.
 *
 * Useful for human-in-the-loop workflows where a human reviews each
 * methodology run before deciding next steps.
 *
 * @param methodology - The methodology to execute
 * @param gates - Strategy-level quality gates evaluated after each run
 * @param safety - Optional safety bounds overrides (merged with defaults)
 * @returns A StrategyController that always completes after one run
 */
export function interactiveController<S>(
  methodology: Methodology<S>,
  gates: Gate<S>[],
  safety?: Partial<SafetyBounds>,
): StrategyController<S> {
  return {
    id: "interactive",
    name: "Interactive Controller",
    methodology,
    gates,
    onComplete: (result) => {
      return Effect.succeed({ tag: "done", result } as StrategyDecision<S>);
    },
    safety: { ...DEFAULT_SAFETY, ...safety },
  };
}
