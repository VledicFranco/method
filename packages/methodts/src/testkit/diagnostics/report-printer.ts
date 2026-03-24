/**
 * Pretty-print CompilationReport and CoherenceResult for diagnostic output.
 */

import type { CompilationReport, CompilationGateResult } from "../../index.js";
import type { CoherenceResult } from "../../index.js";

/** Format a CompilationReport into a readable string. */
export function formatCompilationReport(report: CompilationReport): string {
  const lines: string[] = [
    `Compilation report for ${report.methodId}: ${report.overall.toUpperCase()}`,
    "",
  ];

  for (const gate of report.gates) {
    const icon = gateIcon(gate);
    lines.push(`  ${icon} ${gate.gate}: ${gate.status.toUpperCase()} — ${gate.details}`);
  }

  return lines.join("\n");
}

/** Format a CoherenceResult into a readable string. */
export function formatCoherenceResult(result: CoherenceResult, methodologyId?: string): string {
  const name = methodologyId ?? "methodology";
  const lines: string[] = [
    `Coherence check for ${name}: ${result.coherent ? "COHERENT" : "NOT COHERENT"}`,
    "",
  ];

  for (const check of result.checks) {
    const icon = check.passed ? "[PASS]" : "[FAIL]";
    lines.push(`  ${icon} ${check.name}: ${check.detail}`);
  }

  return lines.join("\n");
}

function gateIcon(gate: CompilationGateResult): string {
  switch (gate.status) {
    case "pass": return "[PASS]";
    case "fail": return "[FAIL]";
    case "needs_review": return "[REVIEW]";
  }
}
