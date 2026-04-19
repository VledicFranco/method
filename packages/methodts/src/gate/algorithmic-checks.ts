// SPDX-License-Identifier: Apache-2.0
/**
 * Algorithmic quality checks for generated code and design artifacts.
 *
 * Every check is deterministic (confidence 1.0). No LLM involved.
 * Moved from semantic/algorithms/gate-runner.ts to gate/ as part of
 * PRD 046 Wave 0 — these are shared infrastructure, not semantic-specific.
 *
 * Checks:
 *   - checkNoAny: are there `any` types in port/interface files?
 *   - checkNoTodos: are there TODO/FIXME/STUB markers?
 *   - checkStructure: does the output have the expected files/sections?
 *   - checkPortFreeze: were frozen ports modified?
 *   - checkPortSubstance: do port interfaces have typed members?
 *   - checkDocumentationSections: does README have required sections?
 *
 * @see PRD 046 — Runtime Consolidation, Wave 0
 * @see fcd-commission SKILL.md — G-NO-ANY, G-NO-TODOS, G-PORT-SUBSTANCE
 * @see exp-spl-design — empirical validation (100% gate pass rate)
 */

// ── Types ──

/** A file artifact produced by code generation. */
export type FileArtifact = {
  readonly path: string;
  readonly content: string;
  readonly kind: "port" | "implementation" | "test" | "readme" | "index" | "config";
};

/** Result of a single algorithmic gate check. */
export type AlgorithmicGateResult = {
  readonly gate: string;
  readonly passed: boolean;
  readonly detail: string;
};

// ── Individual checks ──

/**
 * G-NO-ANY: Check for `any` types in generated code.
 *
 * Matches standalone `any` (word boundary) — avoids matching `company`, `many`, etc.
 * Excludes comments and string literals for accuracy.
 */
export function checkNoAny(files: readonly FileArtifact[]): AlgorithmicGateResult {
  const portFiles = files.filter((f) => f.kind === "port" || f.kind === "implementation");
  let totalAny = 0;
  const details: string[] = [];

  for (const file of portFiles) {
    const stripped = file.content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "")
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, "``");

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
 * G-NO-TODOS: Check for TODO/FIXME/STUB/placeholder markers in generated code.
 *
 * Case-sensitive for TODO/FIXME/etc — avoids false positives on "todo" as a task state.
 */
export function checkNoTodos(files: readonly FileArtifact[]): AlgorithmicGateResult {
  const patterns = /\b(TODO|FIXME|STUB|HACK|XXX)\b|(?:placeholder|not yet implemented)/g;
  let totalMatches = 0;
  const details: string[] = [];

  for (const file of files) {
    if (file.kind === "readme") continue;
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
 * G-STRUCTURE: Check that expected file kinds are present in the output.
 */
export function checkStructure(
  files: readonly FileArtifact[],
  expectedKinds: readonly FileArtifact["kind"][],
): AlgorithmicGateResult {
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
 * G-PORT-FREEZE: Check that frozen ports were not modified.
 */
export function checkPortFreeze(
  files: readonly FileArtifact[],
  frozenPorts: readonly { path: string; content: string }[],
): AlgorithmicGateResult {
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
 * G-PORT-SUBSTANCE: Check that port interfaces have actual type definitions.
 */
export function checkPortSubstance(files: readonly FileArtifact[]): AlgorithmicGateResult {
  const portFiles = files.filter((f) => f.kind === "port");
  const empty: string[] = [];

  for (const file of portFiles) {
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
 * G-DOCS: Check README/documentation has required sections.
 */
export function checkDocumentationSections(
  files: readonly FileArtifact[],
  requiredSections: readonly string[],
): AlgorithmicGateResult {
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
 * Run all applicable algorithmic gate checks on file artifacts.
 */
export function runAlgorithmicGates(
  files: readonly FileArtifact[],
  options?: {
    expectedKinds?: readonly FileArtifact["kind"][];
    frozenPorts?: readonly { path: string; content: string }[];
    requiredSections?: readonly string[];
  },
): { results: AlgorithmicGateResult[]; passRate: number; allPassed: boolean } {
  const results: AlgorithmicGateResult[] = [];

  results.push(checkNoAny(files));
  results.push(checkNoTodos(files));
  results.push(checkPortSubstance(files));

  if (options?.expectedKinds) {
    results.push(checkStructure(files, options.expectedKinds));
  }
  if (options?.frozenPorts) {
    results.push(checkPortFreeze(files, options.frozenPorts));
  }
  if (options?.requiredSections) {
    results.push(checkDocumentationSections(files, options.requiredSections));
  }

  const passRate = results.length > 0
    ? results.filter((r) => r.passed).length / results.length
    : 1;

  return { results, passRate, allPassed: results.every((r) => r.passed) };
}
