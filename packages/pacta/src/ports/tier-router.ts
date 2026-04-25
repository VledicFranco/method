// SPDX-License-Identifier: Apache-2.0
/**
 * TierRouter Port — PRD 057 Surface 2.
 *
 * Pre-call dispatch decision. Inspects the LLM call's input and returns
 * the *name* of a downstream provider. Unlike CascadeProvider's post-hoc
 * `accept` predicate (which inspects the response), TierRouter is
 * consulted BEFORE any provider is called. Right shape for input-driven
 * routing — task difficulty, content type, trust level — where calling
 * a tier just to discover it should have been a different tier is
 * wasteful or impossible.
 *
 * Implementations may be:
 *   - rule-based (keyword features on the AgentRequest)
 *   - SLM-backed (a small classifier trained on prompt → tier pairs)
 *   - LLM-backed (call a cheap LLM to classify — usually wasteful)
 *
 * The router has no awareness of which providers are wired downstream
 * — it returns a name. RoutingProvider resolves the name against its
 * provider registry and dispatches. Pure port — zero implementation
 * imports. Asserted by the G-TIER-ROUTER architecture gate.
 */

import type { Pact, AgentRequest } from '../pact.js';

export interface TierRouter {
  /**
   * Choose a tier name for this call. Implementations should be fast —
   * routing latency is added to every call.
   *
   * @throws TierRouterError when no tier can be selected. RoutingProvider
   *   catches and falls back to its configured default.
   */
  select<T>(pact: Pact<T>, request: AgentRequest): Promise<string>;
}

export class TierRouterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TierRouterError';
  }
}
