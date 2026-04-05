/**
 * KPIChecker Port — PRD 049 contract for automated CheckableKPI generation.
 *
 * Consumed by the Planner (cognitive/modules/planner.ts) to generate
 * machine-checkable KPI predicates from natural language descriptions.
 *
 * Implementations:
 *   - HttpSLMKPIChecker: calls a trained SLM via HTTP bridge (production)
 *   - MockKPIChecker: static response map (testing)
 *   - LLMFallbackKPIChecker: wraps an LLM provider (baseline, unreliable)
 *
 * @see docs/prds/049-kpi-checker-slm.md
 */

import type { CheckableKPI, VerificationState, KPICheckResult } from './verification.js';
import { fileExists, fileContains, fileExports } from './verification.js';

// ── Port Interface ────────────────────────────────────────────

/** Input to the KPIChecker for a single KPI. */
export interface KPICheckerInput {
  /** Natural language KPI description. */
  kpi: string;
  /** Task context for argument extraction. */
  context: {
    objective: string;
    knownPaths: string[];
    knownIdentifiers: string[];
    difficulty?: 'low' | 'medium' | 'high';
  };
}

/** Port: generate CheckableKPI[] from KPI descriptions. */
export interface KPICheckerPort {
  /**
   * Generate checkable predicates for a batch of KPI descriptions.
   * Returns one CheckableKPI per input, with check() populated when the
   * underlying model produces parseable DSL output.
   */
  generateChecks(inputs: KPICheckerInput[]): Promise<CheckableKPI[]>;

  /** Identifier of the backing model/implementation. */
  readonly model: string;

  /** Version tag for tracking. */
  readonly version: string;
}

// ── DSL Parser (grammar from PRD 048) ─────────────────────────

/**
 * Parse a Check DSL expression into a CheckableKPI's check() function.
 *
 * Supported grammar:
 *   expr       := primitive ('&&' primitive)*
 *   primitive  := file_exists(path)
 *              | file_contains(path, pattern)
 *              | file_exports(path, name)
 *              | file_count_changed(delta)
 *
 * Returns null if the DSL is unparseable.
 */
export function parseDSL(dsl: string): ((state: VerificationState) => KPICheckResult) | null {
  const trimmed = dsl.trim();
  if (!trimmed) return null;

  // Split on && (respecting parens is overkill — primitives don't contain &&)
  const parts = trimmed.split(/\s*&&\s*/);
  const checks: Array<(state: VerificationState) => KPICheckResult> = [];

  for (const part of parts) {
    const check = parsePrimitive(part.trim());
    if (!check) return null;
    checks.push(check);
  }

  if (checks.length === 0) return null;
  if (checks.length === 1) return checks[0];

  // Compose with AND
  return (state: VerificationState): KPICheckResult => {
    const results = checks.map(c => c(state));
    const allMet = results.every(r => r.met);
    return {
      met: allMet,
      evidence: results.map(r => r.evidence).join('; '),
    };
  };
}

function parsePrimitive(dsl: string): ((state: VerificationState) => KPICheckResult) | null {
  // file_exists('path')
  const existsMatch = dsl.match(/^file_exists\s*\(\s*['"]([^'"]+)['"]\s*\)$/);
  if (existsMatch) return fileExists(existsMatch[1]);

  // file_contains('path', 'pattern')
  const containsMatch = dsl.match(/^file_contains\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/);
  if (containsMatch) return fileContains(containsMatch[1], containsMatch[2]);

  // file_exports('path', 'name')
  const exportsMatch = dsl.match(/^file_exports\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/);
  if (exportsMatch) return fileExports(exportsMatch[1], exportsMatch[2]);

  // file_count_changed(N) — Planner doesn't have initial VFS state; skip for now
  return null;
}

// ── Build CheckableKPI from DSL string ────────────────────────

/**
 * Convert a raw DSL string + description into a CheckableKPI.
 * If the DSL is unparseable, returns description-only (no check function).
 */
export function buildCheckableKPIFromDSL(description: string, dsl: string): CheckableKPI {
  const check = parseDSL(dsl);
  return {
    description,
    met: false,
    evidence: '',
    ...(check ? { check } : {}),
  };
}
