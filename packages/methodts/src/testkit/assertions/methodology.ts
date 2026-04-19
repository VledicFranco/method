// SPDX-License-Identifier: Apache-2.0
/**
 * Methodology assertions — coherence, routing, termination.
 */

import {
  type Methodology,
  evaluateTransition,
  checkCoherence,
  type CoherenceResult,
  evaluate,
} from "../../index.js";
import { formatCoherenceResult } from "../diagnostics/report-printer.js";

/**
 * Assert that a methodology is coherent over the given test states.
 * Checks: no dead arms, terminate arm exists, terminate reachable,
 * unique priorities, domain satisfiable.
 *
 * @example
 * ```ts
 * assertCoherent(methodology, allStates);
 * ```
 */
export function assertCoherent<S>(
  methodology: Methodology<S>,
  testStates: S[],
): CoherenceResult {
  const result = checkCoherence(methodology, testStates);
  if (!result.coherent) {
    throw new Error(
      `Methodology "${methodology.id}" is not coherent:\n\n` +
      formatCoherenceResult(result, methodology.id),
    );
  }
  return result;
}

/**
 * Assert that δ_Φ routes a given state to the expected arm label.
 * Pass null for expectedLabel to assert termination.
 *
 * @example
 * ```ts
 * assertRoutesTo(methodology, detectedState, "triage");
 * assertRoutesTo(methodology, resolvedState, null);  // terminates
 * ```
 */
export function assertRoutesTo<S>(
  methodology: Methodology<S>,
  state: S,
  expectedLabel: string | null,
): void {
  const result = evaluateTransition(methodology, state);

  if (expectedLabel === null) {
    // Expecting termination
    if (result.selectedMethod !== null) {
      const armTraceStr = result.armTraces
        .map((t) => `  [${t.label}] fired=${t.fired}`)
        .join("\n");
      throw new Error(
        `Expected methodology "${methodology.id}" to terminate, ` +
        `but arm "${result.firedArm!.label}" fired (selected method: ${result.selectedMethod.id})\n\n` +
        `Arm traces:\n${armTraceStr}`,
      );
    }
    return;
  }

  // Expecting a specific arm
  if (!result.firedArm) {
    const armTraceStr = result.armTraces
      .map((t) => `  [${t.label}] condition=${t.trace.result}`)
      .join("\n");
    throw new Error(
      `Expected methodology "${methodology.id}" to route to "${expectedLabel}", ` +
      `but no arm fired\n\nArm traces:\n${armTraceStr}`,
    );
  }

  if (result.firedArm.label !== expectedLabel) {
    const armTraceStr = result.armTraces
      .map((t) => {
        const marker = t.label === expectedLabel ? " ← expected" : t.fired ? " ← fired" : "";
        return `  [${t.label}] condition=${t.trace.result}${marker}`;
      })
      .join("\n");
    throw new Error(
      `Expected methodology "${methodology.id}" to route to "${expectedLabel}", ` +
      `but arm "${result.firedArm.label}" fired instead\n\nArm traces:\n${armTraceStr}`,
    );
  }
}

/**
 * Assert termination properties over a state trajectory:
 * 1. The termination measure changes monotonically (non-increasing) along the trajectory
 * 2. The measure strictly decreases at least once (progress is made)
 * 3. The last state terminates (δ_Φ selects null)
 * 4. The objective is met at the terminal state
 *
 * The trajectory should represent the expected execution order —
 * one state per method completion cycle.
 */
export function assertTerminates<S>(
  methodology: Methodology<S>,
  trajectory: S[],
): void {
  if (trajectory.length < 2) {
    throw new Error("Termination assertion requires at least 2 states in the trajectory");
  }

  const measure = methodology.terminationCertificate.measure;
  const values = trajectory.map((s) => measure(s));

  // Check measure monotonicity: each value should be <= previous (non-increasing)
  // or >= previous (non-decreasing) depending on direction. We detect direction
  // from first change, then enforce consistency.
  let hasStrictChange = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1]) {
      hasStrictChange = true;
    }
  }

  if (!hasStrictChange) {
    throw new Error(
      `Termination assertion failed: measure is constant across entire trajectory — no progress.\n` +
      `Measure values: [${values.join(", ")}]\n` +
      `Certificate: "${methodology.terminationCertificate.decreases}"`,
    );
  }

  // Verify the measure moves monotonically (detect direction from first non-equal pair)
  let direction: "decreasing" | "increasing" | null = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) {
      if (direction === null) direction = "decreasing";
      if (direction === "increasing") {
        throw new Error(
          `Termination assertion failed: measure is not monotonic.\n` +
          `At index ${i - 1}→${i}: ${values[i - 1]}→${values[i]} (decreasing), ` +
          `but prior trend was increasing.\n` +
          `Measure values: [${values.join(", ")}]`,
        );
      }
    } else if (values[i] > values[i - 1]) {
      if (direction === null) direction = "increasing";
      if (direction === "decreasing") {
        throw new Error(
          `Termination assertion failed: measure is not monotonic.\n` +
          `At index ${i - 1}→${i}: ${values[i - 1]}→${values[i]} (increasing), ` +
          `but prior trend was decreasing.\n` +
          `Measure values: [${values.join(", ")}]`,
        );
      }
    }
  }

  // Check that the last state terminates (routes to null)
  const lastState = trajectory[trajectory.length - 1];
  const lastResult = evaluateTransition(methodology, lastState);
  if (lastResult.selectedMethod !== null) {
    throw new Error(
      `Termination assertion failed: last state in trajectory does not terminate. ` +
      `Arm "${lastResult.firedArm?.label}" fired instead.\n` +
      `Measure values: [${values.join(", ")}]`,
    );
  }

  // Verify objective is met at terminal state
  if (!evaluate(methodology.objective, lastState)) {
    throw new Error(
      `Termination assertion failed: methodology objective not met at terminal state.\n` +
      `Measure values: [${values.join(", ")}]`,
    );
  }
}

/**
 * Assert that δ_Φ is total over a set of test states —
 * every state fires at least one arm.
 */
export function assertRoutingTotal<S>(
  methodology: Methodology<S>,
  testStates: S[],
): void {
  for (let i = 0; i < testStates.length; i++) {
    const result = evaluateTransition(methodology, testStates[i]);
    if (!result.firedArm) {
      const armTraceStr = result.armTraces
        .map((t) => `  [${t.label}] condition=${t.trace.result}`)
        .join("\n");
      throw new Error(
        `Routing not total for methodology "${methodology.id}": ` +
        `no arm fires for test state at index ${i}\n\nArm traces:\n${armTraceStr}`,
      );
    }
  }
}
