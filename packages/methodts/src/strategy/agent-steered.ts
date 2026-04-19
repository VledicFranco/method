// SPDX-License-Identifier: Apache-2.0
/**
 * agentSteeredController — Strategy controller that commissions a reasoning
 * agent to decide suspension resolutions and strategy decisions.
 *
 * After each methodology run, the agent receives the result + context and
 * returns a JSON decision: { "action": "done" | "rerun" | "abort", "reason": "..." }
 *
 * Because StrategyController.onComplete must return Effect<StrategyDecision, never, never>
 * (no R channel), the agent execution is injected as a callback rather than
 * pulled from the Effect environment.
 *
 * @see PRD 021 — Agent-steered strategy controller
 */

import { Effect } from "effect";
import type { StrategyController, StrategyDecision } from "./controller.js";
import type { Methodology, SafetyBounds } from "../methodology/methodology.js";
import type { MethodologyResult } from "../runtime/accumulator.js";
import type { Gate } from "../gate/gate.js";
import { Prompt } from "../prompt/prompt.js";

/** Default safety bounds for agent-steered controllers. */
const DEFAULT_SAFETY: SafetyBounds = {
  maxLoops: 5,
  maxTokens: 1_000_000,
  maxCostUsd: 20,
  maxDurationMs: 7_200_000,
  maxDepth: 5,
};

/** Context provided to the steering prompt for agent decision-making. */
export type SteeringContext<S> = {
  readonly result: MethodologyResult<S>;
  readonly runCount: number;
  readonly totalCostUsd: number;
};

/** Configuration for agentSteeredController. */
export type AgentSteeredConfig<S> = {
  readonly methodology: Methodology<S>;
  readonly gates: readonly Gate<S>[];
  readonly safety?: Partial<SafetyBounds>;
  readonly steeringPrompt?: Prompt<SteeringContext<S>>;
};

/** Default steering prompt used when none is provided. */
const defaultSteeringPrompt = new Prompt<SteeringContext<unknown>>((ctx) =>
  `## Strategy Decision Required\n\n` +
  `The methodology completed with status: ${ctx.result.status}\n` +
  `Runs so far: ${ctx.runCount}\n` +
  `Total cost: $${ctx.totalCostUsd.toFixed(2)}\n\n` +
  `Decide the next action. Respond with JSON:\n` +
  `{ "action": "done" | "rerun" | "abort", "reason": "your reasoning" }`,
);

/**
 * Strategy controller that commissions a reasoning agent to decide
 * what to do after each methodology completion.
 *
 * The agent receives the methodology result + context and must return
 * a JSON decision: { "action": "done" | "rerun" | "abort", "reason": "..." }
 *
 * @param config - Controller configuration (methodology, gates, safety, optional prompt)
 * @param agentExecute - Closed-over agent execution function. Receives a prompt string,
 *   returns the agent's raw text response. Must handle its own errors internally
 *   (the Effect should never fail — catch and return a fallback string).
 * @returns A StrategyController with agent-steered decision logic
 */
export function agentSteeredController<S>(
  config: AgentSteeredConfig<S>,
  agentExecute: (prompt: string) => Effect.Effect<string, never, never>,
): StrategyController<S> {
  const prompt = (config.steeringPrompt ?? defaultSteeringPrompt) as Prompt<SteeringContext<S>>;
  let runCount = 0;
  let totalCost = 0;

  return {
    id: "agent-steered",
    name: "Agent-Steered Controller",
    methodology: config.methodology,
    gates: config.gates as Gate<S>[],
    onComplete: (result) =>
      Effect.gen(function* () {
        runCount++;
        totalCost += result.accumulator.totalCostUsd;

        const ctx: SteeringContext<S> = { result, runCount, totalCostUsd: totalCost };
        const promptText = prompt.run(ctx);

        const raw = yield* agentExecute(promptText);

        // Parse agent's decision
        try {
          const decision = JSON.parse(raw);
          switch (decision.action) {
            case "done":
              return { tag: "done", result } as StrategyDecision<S>;
            case "rerun":
              return { tag: "rerun" } as StrategyDecision<S>;
            case "abort":
              return { tag: "abort", reason: decision.reason ?? "Agent decided to abort" } as StrategyDecision<S>;
            default:
              return { tag: "done", result } as StrategyDecision<S>;
          }
        } catch {
          // Parse failed — default to done
          return { tag: "done", result } as StrategyDecision<S>;
        }
      }),
    safety: { ...DEFAULT_SAFETY, ...config.safety },
  };
}
