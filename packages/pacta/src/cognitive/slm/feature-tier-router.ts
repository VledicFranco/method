// SPDX-License-Identifier: Apache-2.0
/**
 * FeatureTierRouter — rule-based TierRouter — PRD 057 Wave 3.
 *
 * Evaluates a list of `FeatureRule`s against the AgentRequest in
 * registration order. The first matching rule's tier wins. If no rule
 * fires, returns the configured default tier.
 *
 * Zero LLM calls. Pure rule evaluation — fast, deterministic, the
 * cheapest possible router and the right starting point for most
 * deployments.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md (Wave 3)
 */

import type { TierRouter } from '../../ports/tier-router.js';
import type { Pact, AgentRequest } from '../../pact.js';

export interface FeatureRule {
  /** Rule name for telemetry. */
  readonly name: string;
  /** Match against the prompt/systemPrompt/pact. Returns true if this rule fires. */
  readonly match: (req: AgentRequest, pact: Pact<unknown>) => boolean;
  /** Tier name to select when matched. */
  readonly tier: string;
}

export interface FeatureTierRouterConfig {
  /** Rules evaluated in order. First match wins. */
  readonly rules: readonly FeatureRule[];
  /** Tier to select when no rule matches. */
  readonly defaultTier: string;
}

export class FeatureTierRouter implements TierRouter {
  private readonly rules: readonly FeatureRule[];
  private readonly defaultTier: string;

  constructor(config: FeatureTierRouterConfig) {
    this.rules = config.rules;
    this.defaultTier = config.defaultTier;
  }

  async select<T>(pact: Pact<T>, request: AgentRequest): Promise<string> {
    for (const rule of this.rules) {
      if (rule.match(request, pact as Pact<unknown>)) {
        return rule.tier;
      }
    }
    return this.defaultTier;
  }
}

/**
 * Match helper: returns a predicate that fires when any of `keywords`
 * appears (case-insensitive) in `req.prompt` or `req.systemPrompt`.
 */
export function keywordMatch(keywords: string[]): (req: AgentRequest) => boolean {
  const lowered = keywords.map((k) => k.toLowerCase());
  return (req: AgentRequest): boolean => {
    const haystack = (req.prompt + ' ' + (req.systemPrompt ?? '')).toLowerCase();
    for (const k of lowered) {
      if (haystack.includes(k)) return true;
    }
    return false;
  };
}

/**
 * Match helper: returns a predicate that fires when `req.prompt.length`
 * exceeds `threshold`.
 */
export function lengthAbove(threshold: number): (req: AgentRequest) => boolean {
  return (req: AgentRequest): boolean => req.prompt.length > threshold;
}
