/**
 * checklistGate — gate runner for checklist attestation workflows.
 *
 * Provides types for structured checklists, parsing attestation output
 * from agent responses, and evaluating whether attestations satisfy
 * the checklist requirements.
 *
 * @see PRD 021 Component 7 — checklistGate runner
 */

import { Effect } from "effect";
import type { Gate, GateResult, GateError } from "../gate.js";
import { gateError } from "../gate.js";
import { TRUE } from "../../predicate/predicate.js";

// ── Checklist types ──

/** A single item in a checklist that requires attestation. */
export type ChecklistItem = {
  readonly id: string;
  readonly claim: string;
  readonly source?: string;
};

/** Configuration for a checklist gate. */
export type ChecklistGateConfig = {
  readonly items: readonly ChecklistItem[];
  readonly requireAll: boolean;
  readonly requireRationale: boolean;
};

/** An agent's attestation for a single checklist item. */
export type ChecklistAttestation = {
  readonly itemId: string;
  readonly attested: boolean;
  readonly rationale: string;
  readonly confidence: "high" | "medium" | "low";
  readonly evidence?: string;
};

/** Extended gate result that includes attestation details. */
export type ChecklistGateResult<S> = GateResult<S> & {
  readonly attestations: ChecklistAttestation[];
  readonly allAttested: boolean;
  readonly lowConfidenceItems: string[];
};

// ── Rendering ──

/**
 * Render checklist items as formatted instructions for an agent prompt.
 *
 * The output is a structured block that an agent can parse and respond to
 * with attestation data.
 *
 * @param config - Checklist configuration
 * @returns Formatted instruction string
 */
export function renderChecklistInstructions(config: ChecklistGateConfig): string {
  const lines: string[] = [];
  lines.push("## Checklist Attestation Required");
  lines.push("");
  lines.push(
    config.requireAll
      ? "You must attest to ALL items below."
      : "Attest to as many items as applicable.",
  );
  if (config.requireRationale) {
    lines.push("Each attestation MUST include a rationale explaining your reasoning.");
  }
  lines.push("");
  lines.push("### Items");
  lines.push("");

  for (const item of config.items) {
    lines.push(`- **[${item.id}]** ${item.claim}`);
    if (item.source) {
      lines.push(`  Source: ${item.source}`);
    }
  }

  lines.push("");
  lines.push("### Response Format");
  lines.push("");
  lines.push("Respond with a JSON array of attestation objects:");
  lines.push("```json");
  lines.push("[");
  lines.push('  { "itemId": "...", "attested": true, "rationale": "...", "confidence": "high"|"medium"|"low", "evidence": "..." }');
  lines.push("]");
  lines.push("```");

  return lines.join("\n");
}

// ── Parsing ──

/**
 * Parse attestation data from raw agent output.
 *
 * Handles two formats:
 * 1. Raw JSON array
 * 2. JSON array embedded in a markdown code block (```json ... ```)
 *
 * @param raw - Raw string output from an agent
 * @param config - Checklist configuration (for validation)
 * @returns Parsed attestation array, or an error string
 */
export function parseAttestations(
  raw: string,
  config: ChecklistGateConfig,
): ChecklistAttestation[] | string {
  // Try extracting from markdown code block first
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return `Failed to parse attestation JSON: invalid JSON`;
  }

  if (!Array.isArray(parsed)) {
    return `Expected JSON array of attestations, got ${typeof parsed}`;
  }

  const attestations: ChecklistAttestation[] = [];
  const validConfidence = new Set(["high", "medium", "low"]);
  const validItemIds = new Set(config.items.map((i) => i.id));

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (typeof entry !== "object" || entry === null) {
      return `Attestation[${i}]: expected object, got ${typeof entry}`;
    }

    const obj = entry as Record<string, unknown>;

    if (typeof obj.itemId !== "string") {
      return `Attestation[${i}]: missing or invalid itemId`;
    }
    if (!validItemIds.has(obj.itemId)) {
      return `Attestation[${i}]: unknown itemId "${obj.itemId}"`;
    }
    if (typeof obj.attested !== "boolean") {
      return `Attestation[${i}]: missing or invalid attested (expected boolean)`;
    }
    if (typeof obj.rationale !== "string") {
      return `Attestation[${i}]: missing or invalid rationale (expected string)`;
    }
    if (!validConfidence.has(obj.confidence as string)) {
      return `Attestation[${i}]: invalid confidence (expected "high", "medium", or "low")`;
    }

    attestations.push({
      itemId: obj.itemId as string,
      attested: obj.attested as boolean,
      rationale: obj.rationale as string,
      confidence: obj.confidence as "high" | "medium" | "low",
      evidence: typeof obj.evidence === "string" ? obj.evidence : undefined,
    });
  }

  return attestations;
}

// ── Evaluation ──

/** Outcome of evaluating attestations against checklist requirements. */
export type ChecklistEvaluation = {
  readonly passed: boolean;
  readonly allAttested: boolean;
  readonly lowConfidenceItems: string[];
  readonly reasons: string[];
};

/**
 * Evaluate whether attestations satisfy the checklist requirements.
 *
 * @param attestations - Parsed attestation array
 * @param config - Checklist configuration
 * @returns Evaluation result
 */
export function evaluateChecklist(
  attestations: ChecklistAttestation[],
  config: ChecklistGateConfig,
): ChecklistEvaluation {
  const reasons: string[] = [];
  const lowConfidenceItems: string[] = [];

  // Check rationale requirement
  if (config.requireRationale) {
    const emptyRationale = attestations.filter((a) => !a.rationale.trim());
    if (emptyRationale.length > 0) {
      const ids = emptyRationale.map((a) => a.itemId).join(", ");
      reasons.push(`Missing rationale for items: ${ids}`);
    }
  }

  // Check attestation status
  const notAttested = attestations.filter((a) => !a.attested);
  const allAttested = notAttested.length === 0;

  if (config.requireAll && notAttested.length > 0) {
    for (const a of notAttested) {
      reasons.push(`Item ${a.itemId} not attested: ${a.rationale}`);
    }
  }

  // Flag low-confidence items
  for (const a of attestations) {
    if (a.confidence === "low") {
      lowConfidenceItems.push(a.itemId);
    }
  }

  // Determine pass/fail
  const rationaleOk = !config.requireRationale || attestations.every((a) => a.rationale.trim());
  const attestOk = !config.requireAll || allAttested;
  const passed = rationaleOk && attestOk;

  return { passed, allAttested, lowConfidenceItems, reasons };
}

// ── Gate constructor ──

/**
 * Create a Gate that evaluates a checklist against attestation data.
 *
 * The state type S must include an `attestationRaw` string field
 * containing the raw agent output to parse attestations from.
 *
 * @param id - Unique identifier for this gate
 * @param config - Checklist configuration
 * @returns A Gate whose evaluate function parses and evaluates attestations
 */
export function checklistGate<S extends { attestationRaw: string }>(
  id: string,
  config: ChecklistGateConfig,
): Gate<S> {
  return {
    id,
    description: `Checklist gate: ${config.items.length} items`,
    predicate: TRUE,
    maxRetries: 0,
    evaluate: (state: S): Effect.Effect<GateResult<S>, GateError, never> =>
      Effect.gen(function* () {
        const start = Date.now();

        const parseResult = parseAttestations(state.attestationRaw, config);
        if (typeof parseResult === "string") {
          return yield* Effect.fail(
            gateError(id, `Attestation parse error: ${parseResult}`),
          );
        }

        const evaluation = evaluateChecklist(parseResult, config);
        const duration_ms = Date.now() - start;

        const result: ChecklistGateResult<S> = {
          passed: evaluation.passed,
          witness: null,
          reason: evaluation.passed
            ? `All checklist requirements met`
            : evaluation.reasons.join("; "),
          feedback: evaluation.passed ? undefined : evaluation.reasons.join("\n"),
          duration_ms,
          attestations: parseResult,
          allAttested: evaluation.allAttested,
          lowConfidenceItems: evaluation.lowConfidenceItems,
        };

        return result;
      }),
  };
}
