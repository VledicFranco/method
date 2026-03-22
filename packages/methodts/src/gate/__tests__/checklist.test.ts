/**
 * Unit tests for checklistGate, attestation parsing, and evaluation.
 *
 * @see PRD 021 Component 7 — checklistGate runner
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  renderChecklistInstructions,
  parseAttestations,
  evaluateChecklist,
  checklistGate,
} from "../runners/checklist-gate.js";
import type {
  ChecklistGateConfig,
  ChecklistAttestation,
  ChecklistGateResult,
} from "../runners/checklist-gate.js";

// ── Test fixtures ──

const config: ChecklistGateConfig = {
  items: [
    { id: "CL-01", claim: "All tests pass", source: "CI pipeline" },
    { id: "CL-02", claim: "No security vulnerabilities" },
    { id: "CL-03", claim: "Documentation updated" },
  ],
  requireAll: true,
  requireRationale: true,
};

const configLenient: ChecklistGateConfig = {
  items: [
    { id: "CL-01", claim: "All tests pass" },
    { id: "CL-02", claim: "No security vulnerabilities" },
  ],
  requireAll: false,
  requireRationale: false,
};

// ── renderChecklistInstructions ──

describe("renderChecklistInstructions", () => {
  it("produces formatted checklist items", () => {
    const output = renderChecklistInstructions(config);

    expect(output).toContain("## Checklist Attestation Required");
    expect(output).toContain("[CL-01]");
    expect(output).toContain("[CL-02]");
    expect(output).toContain("[CL-03]");
    expect(output).toContain("All tests pass");
    expect(output).toContain("No security vulnerabilities");
    expect(output).toContain("Documentation updated");
    expect(output).toContain("Source: CI pipeline");
    expect(output).toContain("MUST include a rationale");
    expect(output).toContain("attest to ALL items");
  });

  it("omits rationale requirement text when not required", () => {
    const output = renderChecklistInstructions(configLenient);

    expect(output).not.toContain("MUST include a rationale");
    expect(output).toContain("as many items as applicable");
  });

  it("includes JSON response format example", () => {
    const output = renderChecklistInstructions(config);

    expect(output).toContain("```json");
    expect(output).toContain('"itemId"');
    expect(output).toContain('"attested"');
    expect(output).toContain('"rationale"');
    expect(output).toContain('"confidence"');
  });
});

// ── parseAttestations ──

describe("parseAttestations", () => {
  it("valid JSON array → parsed correctly", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "Tests pass in CI", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "Snyk scan clean", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "README updated", confidence: "medium" },
    ]);

    const result = parseAttestations(raw, config);
    expect(Array.isArray(result)).toBe(true);

    const attestations = result as ChecklistAttestation[];
    expect(attestations).toHaveLength(3);
    expect(attestations[0].itemId).toBe("CL-01");
    expect(attestations[0].attested).toBe(true);
    expect(attestations[0].confidence).toBe("high");
    expect(attestations[1].rationale).toBe("Snyk scan clean");
  });

  it("embedded in markdown code block → extracted and parsed", () => {
    const raw = `Here are my attestations:

\`\`\`json
[
  { "itemId": "CL-01", "attested": true, "rationale": "Tests pass", "confidence": "high" },
  { "itemId": "CL-02", "attested": false, "rationale": "Found CVE-2024-1234", "confidence": "high" }
]
\`\`\`

Let me know if you need more details.`;

    const result = parseAttestations(raw, configLenient);
    expect(Array.isArray(result)).toBe(true);

    const attestations = result as ChecklistAttestation[];
    expect(attestations).toHaveLength(2);
    expect(attestations[0].attested).toBe(true);
    expect(attestations[1].attested).toBe(false);
    expect(attestations[1].rationale).toBe("Found CVE-2024-1234");
  });

  it("invalid JSON → error string", () => {
    const result = parseAttestations("this is not json {{{", config);
    expect(typeof result).toBe("string");
    expect(result).toContain("Failed to parse");
  });

  it("not an array → error string", () => {
    const result = parseAttestations('{"not": "an array"}', config);
    expect(typeof result).toBe("string");
    expect(result).toContain("Expected JSON array");
  });

  it("unknown itemId → error string", () => {
    const raw = JSON.stringify([
      { itemId: "UNKNOWN-99", attested: true, rationale: "test", confidence: "high" },
    ]);
    const result = parseAttestations(raw, config);
    expect(typeof result).toBe("string");
    expect(result).toContain("unknown itemId");
  });

  it("missing attested field → error string", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", rationale: "test", confidence: "high" },
    ]);
    const result = parseAttestations(raw, config);
    expect(typeof result).toBe("string");
    expect(result).toContain("missing or invalid attested");
  });

  it("invalid confidence value → error string", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "test", confidence: "very-high" },
    ]);
    const result = parseAttestations(raw, config);
    expect(typeof result).toBe("string");
    expect(result).toContain("invalid confidence");
  });

  it("includes evidence when present", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "CI green", confidence: "high", evidence: "Build #1234" },
    ]);
    const result = parseAttestations(raw, configLenient);
    expect(Array.isArray(result)).toBe(true);
    const attestations = result as ChecklistAttestation[];
    expect(attestations[0].evidence).toBe("Build #1234");
  });
});

// ── evaluateChecklist ──

describe("evaluateChecklist", () => {
  it("all attested, high confidence → pass", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "Tests pass", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "Scan clean", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Docs updated", confidence: "high" },
    ];
    const result = evaluateChecklist(attestations, config);

    expect(result.passed).toBe(true);
    expect(result.allAttested).toBe(true);
    expect(result.lowConfidenceItems).toHaveLength(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("one attested=false → fail with rationale as feedback", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "Tests pass", confidence: "high" },
      { itemId: "CL-02", attested: false, rationale: "Found vulnerability CVE-2024-5678", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Docs updated", confidence: "high" },
    ];
    const result = evaluateChecklist(attestations, config);

    expect(result.passed).toBe(false);
    expect(result.allAttested).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("CL-02"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("Found vulnerability CVE-2024-5678"))).toBe(true);
  });

  it("low confidence item → pass but flagged in lowConfidenceItems", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "Tests pass", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "Probably ok", confidence: "low" },
      { itemId: "CL-03", attested: true, rationale: "Updated", confidence: "high" },
    ];
    const result = evaluateChecklist(attestations, config);

    expect(result.passed).toBe(true);
    expect(result.allAttested).toBe(true);
    expect(result.lowConfidenceItems).toContain("CL-02");
    expect(result.lowConfidenceItems).toHaveLength(1);
  });

  it("missing rationale when requireRationale → fail", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "Tests pass", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Updated", confidence: "high" },
    ];
    const result = evaluateChecklist(attestations, config);

    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("Missing rationale"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("CL-02"))).toBe(true);
  });

  it("missing rationale when not required → pass", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "", confidence: "high" },
    ];
    const result = evaluateChecklist(attestations, configLenient);

    expect(result.passed).toBe(true);
  });

  it("not all attested when requireAll=false → pass", () => {
    const attestations: ChecklistAttestation[] = [
      { itemId: "CL-01", attested: true, rationale: "Pass", confidence: "high" },
      { itemId: "CL-02", attested: false, rationale: "N/A", confidence: "medium" },
    ];
    const result = evaluateChecklist(attestations, configLenient);

    expect(result.passed).toBe(true);
    expect(result.allAttested).toBe(false);
  });
});

// ── checklistGate ──

describe("checklistGate", () => {
  type ChecklistState = { attestationRaw: string; value: number };

  it("valid attestations that pass → gate passes", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "Tests pass", confidence: "high" },
      { itemId: "CL-02", attested: true, rationale: "Clean scan", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Docs done", confidence: "high" },
    ]);

    const gate = checklistGate<ChecklistState>("cl-gate", config);
    const result = Effect.runSync(gate.evaluate({ attestationRaw: raw, value: 1 }));

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("All checklist requirements met");
    expect(result.feedback).toBeUndefined();

    // ChecklistGateResult extended fields
    const clResult = result as ChecklistGateResult<ChecklistState>;
    expect(clResult.attestations).toHaveLength(3);
    expect(clResult.allAttested).toBe(true);
    expect(clResult.lowConfidenceItems).toHaveLength(0);
  });

  it("invalid JSON in state → GateError", () => {
    const gate = checklistGate<ChecklistState>("cl-gate", config);
    const exit = Effect.runSyncExit(gate.evaluate({ attestationRaw: "not json", value: 1 }));

    expect(exit._tag).toBe("Failure");
  });

  it("failed attestation → gate fails with reasons", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "Pass", confidence: "high" },
      { itemId: "CL-02", attested: false, rationale: "CVE found", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Done", confidence: "high" },
    ]);

    const gate = checklistGate<ChecklistState>("cl-gate", config);
    const result = Effect.runSync(gate.evaluate({ attestationRaw: raw, value: 1 }));

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("CL-02");
    expect(result.feedback).toBeDefined();
  });

  it("gate metadata is correct", () => {
    const gate = checklistGate<ChecklistState>("my-cl", config);

    expect(gate.id).toBe("my-cl");
    expect(gate.description).toBe("Checklist gate: 3 items");
    expect(gate.maxRetries).toBe(0);
  });

  it("ChecklistGateResult includes low confidence items", () => {
    const raw = JSON.stringify([
      { itemId: "CL-01", attested: true, rationale: "Pass", confidence: "low" },
      { itemId: "CL-02", attested: true, rationale: "Scan", confidence: "high" },
      { itemId: "CL-03", attested: true, rationale: "Done", confidence: "low" },
    ]);

    const gate = checklistGate<ChecklistState>("cl-gate", config);
    const result = Effect.runSync(gate.evaluate({ attestationRaw: raw, value: 1 })) as ChecklistGateResult<ChecklistState>;

    expect(result.passed).toBe(true);
    expect(result.lowConfidenceItems).toContain("CL-01");
    expect(result.lowConfidenceItems).toContain("CL-03");
    expect(result.lowConfidenceItems).toHaveLength(2);
  });
});
