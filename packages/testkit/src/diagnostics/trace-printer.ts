/**
 * Pretty-print EvalTrace trees for diagnostic output on assertion failure.
 */

import type { EvalTrace } from "@method/methodts";

/**
 * Format an EvalTrace into a human-readable tree string.
 *
 * Example output:
 *   AND ── false
 *   ├─ is_detected ── true
 *   └─ NOT ── false
 *      └─ has_severity ── true
 */
export function formatTrace(trace: EvalTrace, indent: string = "", isLast: boolean = true): string {
  const connector = indent === "" ? "" : isLast ? "└─ " : "├─ ";
  const resultStr = trace.result ? "true" : "false";
  const line = `${indent}${connector}${trace.label} ── ${resultStr}`;

  if (trace.children.length === 0) return line;

  const childIndent = indent === "" ? "" : indent + (isLast ? "   " : "│  ");
  const childLines = trace.children.map((child, i) =>
    formatTrace(child, childIndent, i === trace.children.length - 1),
  );

  return [line, ...childLines].join("\n");
}

/**
 * Format a trace, highlighting the failing branches.
 * Prefixes failing leaf nodes with a marker.
 */
export function formatTraceWithFailures(trace: EvalTrace): string {
  return formatTraceMarked(trace, "", true);
}

function formatTraceMarked(trace: EvalTrace, indent: string, isLast: boolean): string {
  const connector = indent === "" ? "" : isLast ? "└─ " : "├─ ";
  const resultStr = trace.result ? "true" : "false";
  const marker = !trace.result && trace.children.length === 0 ? " ← FAILED" : "";
  const line = `${indent}${connector}${trace.label} ── ${resultStr}${marker}`;

  if (trace.children.length === 0) return line;

  const childIndent = indent === "" ? "" : indent + (isLast ? "   " : "│  ");
  const childLines = trace.children.map((child, i) =>
    formatTraceMarked(child, childIndent, i === trace.children.length - 1),
  );

  return [line, ...childLines].join("\n");
}
