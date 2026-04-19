// SPDX-License-Identifier: Apache-2.0
/**
 * gate-runner — Re-exports from @methodts/methodts/gate/algorithmic-checks.
 *
 * PRD 046 Wave 0: Algorithmic checks moved to gate/ as shared infrastructure.
 * This file re-exports for backward compatibility + adds the Truth-aware
 * `runGates()` wrapper that converts AlgorithmicGateResult to Truth.
 *
 * @see gate/algorithmic-checks.ts — canonical location
 */

import type { Truth } from "../truth.js";
import { algorithmic } from "../truth.js";

// Re-export types and check functions from canonical location
export { type FileArtifact, type AlgorithmicGateResult as GateCheckResult } from "../../gate/algorithmic-checks.js";
export { checkNoAny, checkNoTodos, checkStructure, checkPortFreeze, checkPortSubstance, checkDocumentationSections } from "../../gate/algorithmic-checks.js";

import type { FileArtifact } from "../../gate/algorithmic-checks.js";
import { runAlgorithmicGates } from "../../gate/algorithmic-checks.js";

// ── Truth-aware composite runner (semantic-specific) ──

/**
 * Run all applicable gate checks on file artifacts and convert to Truths.
 *
 * This is the semantic module's wrapper around runAlgorithmicGates that
 * adds Truth conversion for confidence tracking.
 */
export function runGates(
  files: readonly FileArtifact[],
  options?: {
    expectedKinds?: readonly FileArtifact["kind"][];
    frozenPorts?: readonly { path: string; content: string }[];
    requiredSections?: readonly string[];
  },
): { results: Array<{ gate: string; passed: boolean; detail: string }>; truths: Truth[]; passRate: number } {
  const { results, passRate } = runAlgorithmicGates(files, options);

  const truths = results.map((r) =>
    algorithmic(`gate:${r.gate}`, r.passed),
  );

  return { results, truths, passRate };
}
