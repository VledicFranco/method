// SPDX-License-Identifier: Apache-2.0
/**
 * Control Policy — validation and enforcement of control directives.
 *
 * The cycle orchestrator validates every control directive against the ControlPolicy
 * before passing it to the target module. Directives that fail validation are rejected
 * and emit CognitiveControlPolicyViolation events.
 *
 * Grounded in: Nelson & Narens monitor/control metacognition — control is not
 * unconstrained; the system declares what directives are permitted.
 */

import type { ControlDirective } from './module.js';

// ── Control Policy ───────────────────────────────────────────────

/** Declares what control directives are permitted in a cognitive composition. */
export interface ControlPolicy {
  /** Allowed directive type discriminants. */
  allowedDirectiveTypes: string[];

  /** Maximum sub-agent spawn depth (default: 0 = no spawning). */
  maxSpawnDepth?: number;

  /** Whitelist for Actor directives — which actions are permitted. */
  allowedActions?: string[];

  /** Validate a directive against this policy. Returns true if permitted. */
  validate(directive: ControlDirective): boolean;
}

// ── Violation Record ─────────────────────────────────────────────

/** Record of a control directive that was rejected by the policy. */
export interface ControlPolicyViolation {
  /** The directive that was rejected. */
  directive: ControlDirective;

  /** Why the directive was rejected. */
  reason: string;

  /** When the violation occurred. */
  timestamp: number;
}
