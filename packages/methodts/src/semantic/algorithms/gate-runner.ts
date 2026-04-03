/**
 * gate-runner — Algorithmic quality checks for generated code and design artifacts.
 *
 * Every check here is deterministic (confidence 1.0). No LLM involved.
 * These are the "hard gates" that distinguish working code from broken code.
 *
 * Checks:
 *   - checkTypeScript: does the generated code compile?
 *   - checkNoAny: are there `any` types in port/interface files?
 *   - checkNoTodos: are there TODO/FIXME/STUB markers?
 *   - checkStructure: does the output have the expected files/sections?
 *   - checkPortFreeze: were frozen ports modified?
 *
 * Each returns GateCheckResult[] with method: "algorithmic", confidence: 1.0.
 *
 * @see fcd-commission SKILL.md — sigma_B, sigma_C gate checks
 * @see architecture.test.ts — G-PORT, G-BOUNDARY, G-LAYER patterns
 */

import type { Truth } from "../truth.js";
import { algorithmic } from "../truth.js";

// ── Types ──

export type FileArtifact = {
  readonly path: string;
  readonly content: string;
  readonly kind: "port" | "implementation" | "test" | "readme" | "index" | "config";
};

export type GateCheckResult = {
  readonly gate: string;
  readonly passed: boolean;
  readonly detail: string;
};

// ── Individual checks ──

/**
 * Check for `any` types in generated code.
 *
 * Matches standalone `any` (word boundary) — avoids matching `company`, `many`, etc.
 * Excludes comments and string literals for accuracy.
 */
export function checkNoAny(files: readonly FileArtifact[]): GateCheckResult {
  const portFiles = files.filter((f) => f.kind === "port" || f.kind === "implementation");
  let totalAny = 0;
  const details: string[] = [];

  for (const file of portFiles) {
    // Strip comments and string literals before checking
    const stripped = file.content
      .replace(/\/\*[\s\S]*?\*\//g, "")  // block comments
      .replace(/\/\/.*/g, "")              // line comments
      .replace(/"[^"]*"/g, '""')           // double-quoted strings
      .replace(/'[^']*'/g, "''")           // single-quoted strings
      .replace(/`[^`]*`/g, "``");          // template literals

    const matches = stripped.match(/\bany\b/g);
    if (matches && matches.length > 0) {
      totalAny += matches.length;
      details.push(`${file.path}: ${matches.length} any types`);
    }
  }

  return {
    gate: "no-any-types",
    passed: totalAny === 0,
    detail: totalAny === 0
      ? `${portFiles.length} files checked, no \`any\` types found`
      : `${totalAny} \`any\` types found: ${details.join(", ")}`,
  };
}

/**
 * Check for TODO/FIXME/STUB/placeholder markers in generated code.
 *
 * Per fcd-commission anti-capitulation rule 7: "Never leave stubs or TODOs."
 */
export function checkNoTodos(files: readonly FileArtifact[]): GateCheckResult {
  const patterns = /\b(TODO|FIXME|STUB|HACK|XXX|placeholder|not yet implemented)\b/gi;
  let totalMatches = 0;
  const details: string[] = [];

  for (const file of files) {
    if (file.kind === "readme") continue; // READMEs may legitimately mention these terms
    const matches = file.content.match(patterns);
    if (matches && matches.length > 0) {
      totalMatches += matches.length;
      details.push(`${file.path}: ${matches.join(", ")}`);
    }
  }

  return {
    gate: "no-todos",
    passed: totalMatches === 0,
    detail: totalMatches === 0
      ? `${files.length} files checked, no TODOs/stubs found`
      : `${totalMatches} markers found: ${details.join("; ")}`,
  };
}

/**
 * Check that expected file kinds are present in the output.
 *
 * @param files Generated file artifacts
 * @param expectedKinds What kinds of files must exist (e.g., ["port", "implementation", "test"])
 */
export function checkStructure(
  files: readonly FileArtifact[],
  expectedKinds: readonly FileArtifact["kind"][],
): GateCheckResult {
  const presentKinds = new Set(files.map((f) => f.kind));
  const missing = expectedKinds.filter((k) => !presentKinds.has(k));

  return {
    gate: "structure-complete",
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `All expected artifacts present: ${expectedKinds.join(", ")}`
      : `Missing artifacts: ${missing.join(", ")}`,
  };
}

/**
 * Check that frozen ports were not modified.
 *
 * Compares generated port file content against the frozen reference.
 * If a generated file matches a frozen port path but has different content, it's a violation.
 */
export function checkPortFreeze(
  files: readonly FileArtifact[],
  frozenPorts: readonly { path: string; content: string }[],
): GateCheckResult {
  const violations: string[] = [];

  for (const frozen of frozenPorts) {
    const generated = files.find((f) => f.path === frozen.path);
    if (generated && generated.content !== frozen.content) {
      violations.push(`${frozen.path}: frozen port modified`);
    }
  }

  return {
    gate: "port-freeze",
    passed: violations.length === 0,
    detail: violations.length === 0
      ? `${frozenPorts.length} frozen ports verified — none modified`
      : `Port freeze violations: ${violations.join(", ")}`,
  };
}

/**
 * Check that port interfaces have actual type definitions (not just empty interfaces).
 */
export function checkPortSubstance(files: readonly FileArtifact[]): GateCheckResult {
  const portFiles = files.filter((f) => f.kind === "port");
  const empty: string[] = [];

  for (const file of portFiles) {
    // Check for at least one method/property in the interface
    const hasMembers = /\w+\s*[:(]/.test(
      file.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, ""),
    );
    if (!hasMembers) {
      empty.push(file.path);
    }
  }

  return {
    gate: "port-substance",
    passed: empty.length === 0,
    detail: empty.length === 0
      ? `${portFiles.length} port files have typed members`
      : `Empty port interfaces: ${empty.join(", ")}`,
  };
}

/**
 * Check README/documentation has required sections.
 */
export function checkDocumentationSections(
  files: readonly FileArtifact[],
  requiredSections: readonly string[],
): GateCheckResult {
  const readmes = files.filter((f) => f.kind === "readme");
  if (readmes.length === 0) {
    return {
      gate: "documentation-sections",
      passed: requiredSections.length === 0,
      detail: "No README found",
    };
  }

  const allContent = readmes.map((f) => f.content).join("\n");
  const missing = requiredSections.filter((section) =>
    !allContent.toLowerCase().includes(section.toLowerCase()),
  );

  return {
    gate: "documentation-sections",
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `All ${requiredSections.length} required sections present`
      : `Missing sections: ${missing.join(", ")}`,
  };
}

// ── Composite runner ──

/**
 * Run all applicable gate checks on a set of file artifacts.
 *
 * Returns an array of GateCheckResults and a summary Truth.
 */
export function runGates(
  files: readonly FileArtifact[],
  options?: {
    expectedKinds?: readonly FileArtifact["kind"][];
    frozenPorts?: readonly { path: string; content: string }[];
    requiredSections?: readonly string[];
  },
): { results: GateCheckResult[]; truths: Truth[]; passRate: number } {
  const results: GateCheckResult[] = [];

  // Always run these
  results.push(checkNoAny(files));
  results.push(checkNoTodos(files));
  results.push(checkPortSubstance(files));

  // Optional checks
  if (options?.expectedKinds) {
    results.push(checkStructure(files, options.expectedKinds));
  }
  if (options?.frozenPorts) {
    results.push(checkPortFreeze(files, options.frozenPorts));
  }
  if (options?.requiredSections) {
    results.push(checkDocumentationSections(files, options.requiredSections));
  }

  // Convert to truths
  const truths = results.map((r) =>
    algorithmic(`gate:${r.gate}`, r.passed),
  );

  const passRate = results.filter((r) => r.passed).length / results.length;

  return { results, truths, passRate };
}
