// SPDX-License-Identifier: Apache-2.0
/**
 * assembleContext — 4-channel step context assembly.
 *
 * Assembles a StepContext by:
 *   1. World reads — pre-populated fragments (actual execution deferred to Wave 4)
 *   2. Insights — gathered from InsightStore based on insightDeps
 *   3. Domain facts — rendered from DomainTheory via DomainFactsSpec
 *   4. Sufficiency check — predicate validation on the assembled context
 *
 * @see PRD 021 §12.3 — Step Context Protocol
 */

import { Effect } from "effect";
import type { ContextSpec, StepContext } from "../method/step.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { InsightStore } from "./insight-store.js";
import { renderDomainFacts } from "./domain-facts.js";
import { evaluate } from "../predicate/evaluate.js";

/** Error raised when context assembly fails (e.g., sufficiency check). */
export type ContextError = {
  readonly _tag: "ContextError";
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Assemble the 4-channel step context for an agent step.
 *
 * Channel 1 (world reads) accepts pre-populated fragments rather than
 * executing ContextRead extractors. The runtime (Wave 4) will handle
 * actual worldRead execution and pass the results here.
 *
 * @param contextSpec  - The step's context specification
 * @param state        - Current world state
 * @param worldFragments - Pre-populated world read results (key → value)
 * @param insightStore - The shared insight store
 * @param domain       - The domain theory for rendering facts
 * @param role         - Optional role for constraint rendering
 */
export function assembleContext<S>(
  contextSpec: ContextSpec<S>,
  state: S,
  worldFragments: Record<string, string>,
  insightStore: InsightStore,
  domain: DomainTheory<S>,
  role?: Role<S, any>,
): Effect.Effect<StepContext<S>, ContextError, never> {
  return Effect.gen(function* () {
    // Channel 1: World reads (pre-populated)
    const world: Record<string, string> = { ...worldFragments };

    // Channel 2: Insights from store
    const insights: Record<string, string> = {};
    if (contextSpec.insightDeps) {
      const allInsights = yield* insightStore.getAll();
      for (const key of contextSpec.insightDeps) {
        if (allInsights[key] !== undefined) {
          insights[key] = allInsights[key];
        }
      }
    }

    // Channel 3: Domain facts
    const domainFacts = contextSpec.domainFacts
      ? renderDomainFacts(contextSpec.domainFacts, domain, role)
      : "";

    // Assemble the context
    const ctx: StepContext<S> = { state, world, insights, domainFacts };

    // Channel 4: Sufficiency check
    if (contextSpec.sufficient) {
      const sufficient = evaluate(contextSpec.sufficient, ctx);
      if (!sufficient) {
        return yield* Effect.fail<ContextError>({
          _tag: "ContextError",
          message: "Assembled context failed sufficiency check",
        });
      }
    }

    return ctx;
  });
}
