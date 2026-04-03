/**
 * implement — FCA-recursive implementation algorithm with gate-check-fix loop.
 *
 * Given a DesignOutput, produces working code that passes algorithmic gates.
 * The key innovation: the LLM generates code, algorithmic gates check it,
 * and if gates fail, the LLM gets the error feedback and retries.
 *
 * Architecture: implement produces FileArtifact[] as data (not file writes).
 * A separate materialization step writes to disk and runs full gate checks.
 * This keeps the SPL functions pure and testable with RecordingProvider.
 *
 * The pipeline pattern: generate → gate-check → (retry if gates fail)
 * Retry uses the existing postcondition mechanism in runAtomic — if the
 * postcondition "all gates pass" fails, the runner retries with error feedback.
 *
 * @see fcd-commission SKILL.md — sigma_B (implementation complete)
 * @see advice/03-recursive-semantic-algorithms.md — Semantic vs algorithmic
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { SemanticFn } from "../fn.js";
import { recurse } from "../compose.js";
import type { DesignOutput } from "./design.js";
import type { FileArtifact, GateCheckResult } from "./gate-runner.js";
import { runGates } from "./gate-runner.js";
import type { FsLoader } from "./fs-loader.js";

// ── Types ──

/** Input to the implement function at each level. */
export type ImplementInput = {
  /** The design to implement. */
  readonly design: DesignOutput;
  /** Where to write files. */
  readonly path: string;
  /** FCA level. */
  readonly level: number;
  /** Port files that must NOT be modified (frozen from Wave 0). */
  readonly frozenPorts: readonly string[];
  /** Existing code at this path (context for the LLM). */
  readonly existingCode: string;
  /** Constraints inherited from parent. */
  readonly constraints: readonly string[];
};

/** Output from the implement function at each level. */
export type ImplementOutput = {
  readonly path: string;
  readonly level: number;
  /** Files produced by the implementation. */
  readonly files: readonly FileArtifact[];
  /** Gate check results (algorithmic, confidence 1.0). */
  readonly gateResults: readonly GateCheckResult[];
  /** Whether all gates passed. */
  readonly allGatesPass: boolean;
  /** Child implementations (populated by recursion). */
  readonly childImplementations: readonly ImplementOutput[];
};

// ── Prompt ──

const implementPrompt = new Prompt<ImplementInput>((input) => {
  const levelName = ["Function", "Module", "Domain", "Package", "Service", "System"][input.level] ?? `L${input.level}`;
  const portContext = input.design.portFileContent
    ? `\nFROZEN PORT INTERFACES (do NOT modify these):\n${input.design.portFileContent}`
    : "";

  return `Implement L${input.level} ${levelName} at ${input.path}

DESIGN:
${input.design.draftDocumentation}

${input.design.subComponents.length > 0
    ? `SUB-COMPONENTS:\n${input.design.subComponents.map((s) => `- ${s.name}: ${s.purpose}`).join("\n")}`
    : ""}
${portContext}

EXISTING CODE:
${input.existingCode.slice(0, 2000) || "(new component)"}

CONSTRAINTS:
${input.constraints.length > 0 ? input.constraints.map((c) => `- ${c}`).join("\n") : "(none)"}

INSTRUCTIONS:
Generate complete, working TypeScript code. For each file, output:

FILE: <relative-path>
KIND: <port|implementation|test|readme|index>
\`\`\`typescript
<complete file content>
\`\`\`

Rules:
- Every function must have a complete body (NO stubs, NO TODOs, NO placeholders)
- Use strict TypeScript (no \`any\` types)
- Port interfaces: if frozen ports provided, import and implement them — do NOT redefine
- Tests: co-locate with implementation (*.test.ts next to *.ts)
- Exports: re-export public surface through index.ts
- Keep files focused — one concern per file

Generate ALL files needed for this component.`;
});

// ── Parser ──

function parseImplementOutput(raw: string, input: ImplementInput): ImplementOutput | null {
  const files: FileArtifact[] = [];
  // Match FILE: <path>\nKIND: <kind>\n```typescript\n<content>\n```
  const fileRegex = /FILE:\s*(.+)\nKIND:\s*(\w+)\n```(?:typescript|ts)?\n([\s\S]*?)```/g;
  let match;
  while ((match = fileRegex.exec(raw)) !== null) {
    const path = match[1].trim();
    const kindRaw = match[2].trim().toLowerCase();
    const content = match[3].trim();
    const kind = (["port", "implementation", "test", "readme", "index", "config"].includes(kindRaw)
      ? kindRaw
      : "implementation") as FileArtifact["kind"];
    files.push({ path, content, kind });
  }

  if (files.length === 0) return null;

  // Run algorithmic gate checks on the generated files
  const { results: gateResults } = runGates(files, {
    expectedKinds: input.level >= 1 ? ["implementation"] : undefined,
  });

  const allGatesPass = gateResults.every((g) => g.passed);

  return {
    path: input.path,
    level: input.level,
    files,
    gateResults,
    allGatesPass,
    childImplementations: [],
  };
}

// ── The Semantic Function ──

/**
 * Implement a single level — generate code + run inline gate checks.
 *
 * The postcondition "all gates pass" triggers retry via runAtomic if gates
 * fail — the LLM gets the error feedback automatically.
 */
export const implementLevel: SemanticFn<ImplementInput, ImplementOutput> = semanticFn({
  name: "implement-level",
  prompt: implementPrompt,
  parse: parseImplementOutput,
  pre: [
    check("design has documentation", (i: ImplementInput) => i.design.draftDocumentation.length > 0),
    check("path is non-empty", (i: ImplementInput) => i.path.length > 0),
  ],
  post: [
    check("files generated", (o: ImplementOutput) => o.files.length > 0),
    check("all inline gates pass", (o: ImplementOutput) => o.allGatesPass),
  ],
  maxRetries: 2, // Up to 2 retries if gates fail — LLM gets error feedback
});

/**
 * The full recursive implement algorithm.
 *
 * Recursion follows the design's sub-component structure.
 * At each level: implement → gate-check → recurse into children.
 */
export const implement: SemanticFn<ImplementInput, ImplementOutput> = recurse(
  implementLevel,
  // Decompose: follow the design's sub-components
  (output: ImplementOutput, input: ImplementInput) =>
    input.design.childDesigns.map((childDesign) => ({
      design: childDesign,
      path: childDesign.path,
      level: childDesign.level,
      // Own port files become frozen for children
      frozenPorts: [
        ...input.frozenPorts,
        ...output.files.filter((f) => f.kind === "port").map((f) => f.path),
      ],
      existingCode: "",
      constraints: [
        ...input.constraints,
        ...childDesign.ports.map((p) => `Frozen port: ${p.name} — ${p.description}`),
      ],
    })),
  // Recompose: attach child implementations
  (own: ImplementOutput, children: ImplementOutput[]) => ({
    ...own,
    childImplementations: children,
    // Update allGatesPass to consider children
    allGatesPass: own.allGatesPass && children.every((c) => c.allGatesPass),
  }),
  // Base case: no child designs to recurse into
  (input: ImplementInput) => input.design.childDesigns.length === 0,
);

/**
 * Create a recursive implement algorithm with filesystem context.
 */
export function createImplementWithFs(fs: FsLoader): SemanticFn<ImplementInput, ImplementOutput> {
  return recurse(
    implementLevel,
    (output: ImplementOutput, input: ImplementInput) =>
      input.design.childDesigns.map((childDesign) => ({
        design: childDesign,
        path: childDesign.path,
        level: childDesign.level,
        frozenPorts: [
          ...input.frozenPorts,
          ...output.files.filter((f) => f.kind === "port").map((f) => f.path),
        ],
        existingCode: fs.exists(childDesign.path)
          ? fs.readFile(childDesign.path)
          : "",
        constraints: [
          ...input.constraints,
          ...childDesign.ports.map((p) => `Frozen port: ${p.name} — ${p.description}`),
        ],
      })),
    (own: ImplementOutput, children: ImplementOutput[]) => ({
      ...own,
      childImplementations: children,
      allGatesPass: own.allGatesPass && children.every((c) => c.allGatesPass),
    }),
    (input: ImplementInput) => input.design.childDesigns.length === 0,
  );
}
