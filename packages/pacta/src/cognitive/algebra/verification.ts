/**
 * Verification Types + Check Primitives — PRD 048 Cybernetic Verification Loop.
 *
 * Provides the algebra surfaces for action-outcome verification:
 * - VerificationState: what the verifier can inspect (VFS + action history)
 * - CheckableKPI: KPI with optional machine-checkable predicate
 * - VerificationResult: outcome of verifying an action
 * - CorrectionSignal: injected into store when verification fails
 *
 * Check primitives are composable predicates over VerificationState:
 *   fileExists(path) && fileContains(path, /export function handleOrderV2/)
 *
 * Reuses the Predicate composition pattern from @method/methodts Gate<S>.
 *
 * @see docs/prds/048-cybernetic-verification-loop.md
 * @see docs/rfcs/006-anticipatory-monitoring.md — Part IV (Verification)
 */

// ── Verification State ────────────────────────────────────────

/** State available to KPI check predicates. */
export interface VerificationState {
  /** Current virtual filesystem contents. */
  files: ReadonlyMap<string, string>;
  /** Last action taken by the ReasonerActor. */
  lastAction: { tool: string; input: unknown; result: unknown };
  /** All actions taken this run. */
  actionHistory: Array<{ tool: string; cycle: number }>;
}

// ── KPI Check Result ──────────────────────────────────────────

export interface KPICheckResult {
  met: boolean;
  evidence: string;
}

// ── Checkable KPI ─────────────────────────────────────────────

/**
 * A KPI with an optional machine-checkable predicate.
 *
 * When check() is present, the Verifier runs it directly against VFS state
 * (zero LLM cost, 100% reliable). When absent, falls back to LLM assessment.
 */
export interface CheckableKPI {
  /** Human-readable description. */
  description: string;
  /** Machine-checkable predicate. */
  check?: (state: VerificationState) => KPICheckResult;
  /** Whether this KPI was met in the last verification. */
  met: boolean;
  /** Evidence for the current status. */
  evidence: string;
}

// ── Verification Result ───────────────────────────────────────

/**
 * Result of verifying the last action's outcome.
 */
export interface VerificationResult {
  /** Did the action achieve its intended outcome? */
  verified: boolean;
  /** Per-KPI status. */
  kpiStatus: Array<{ kpi: string; met: boolean; evidence: string }>;
  /** Diagnosis if verification failed. */
  diagnosis?: string;
  /** Suggested correction if failed. */
  correction?: CorrectionSignal;
}

// ── Correction Signal ─────────────────────────────────────────

/**
 * Signal injected into the unified store when verification fails.
 * High salience — the ReasonerActor's spreading activation surfaces it
 * in the next cycle's context, driving corrective action.
 */
export interface CorrectionSignal {
  /** What went wrong (specific, actionable). */
  problem: string;
  /** Suggested fix (specific, actionable). */
  suggestion: string;
  /** Which KPIs remain unmet. */
  unmetKPIs: string[];
  /** How many verification failures for this subgoal. */
  failureCount: number;
}

// ── Check Primitives (Composable Predicates) ──────────────────

/**
 * Check that a file exists in the VFS.
 */
export function fileExists(path: string): (state: VerificationState) => KPICheckResult {
  return (state) => {
    const exists = state.files.has(path);
    return {
      met: exists,
      evidence: exists ? `${path} exists` : `${path} does not exist`,
    };
  };
}

/**
 * Check that a file contains a pattern (regex or string).
 */
export function fileContains(path: string, pattern: string | RegExp): (state: VerificationState) => KPICheckResult {
  return (state) => {
    const content = state.files.get(path);
    if (!content) {
      return { met: false, evidence: `${path} does not exist` };
    }
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const matches = regex.test(content);
    return {
      met: matches,
      evidence: matches
        ? `${path} contains pattern ${regex.source}`
        : `${path} does not contain pattern ${regex.source}`,
    };
  };
}

/**
 * Check that a file exports a named symbol (looks for 'export' + name patterns).
 */
export function fileExports(path: string, name: string): (state: VerificationState) => KPICheckResult {
  return (state) => {
    const content = state.files.get(path);
    if (!content) {
      return { met: false, evidence: `${path} does not exist` };
    }
    // Match: export function name, export const name, export class name, export { name }
    const exportPattern = new RegExp(
      `export\\s+(?:function|const|class|interface|type|enum)\\s+${name}\\b|` +
      `export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
    );
    const matches = exportPattern.test(content);
    return {
      met: matches,
      evidence: matches
        ? `${path} exports '${name}'`
        : `${path} does not export '${name}'`,
    };
  };
}

/**
 * Check that the number of new files (not in initial set) matches expected delta.
 */
export function fileCountChanged(expectedDelta: number, initialFiles: ReadonlyMap<string, string>): (state: VerificationState) => KPICheckResult {
  return (state) => {
    let newCount = 0;
    for (const path of state.files.keys()) {
      if (!initialFiles.has(path)) newCount++;
    }
    return {
      met: newCount >= expectedDelta,
      evidence: `${newCount} new files (expected ≥ ${expectedDelta})`,
    };
  };
}

/**
 * Compose two check predicates with AND.
 */
export function allChecks(...checks: Array<(state: VerificationState) => KPICheckResult>): (state: VerificationState) => KPICheckResult {
  return (state) => {
    const results = checks.map(c => c(state));
    const allMet = results.every(r => r.met);
    return {
      met: allMet,
      evidence: results.map(r => r.evidence).join('; '),
    };
  };
}

/**
 * Compose two check predicates with OR.
 */
export function anyCheck(...checks: Array<(state: VerificationState) => KPICheckResult>): (state: VerificationState) => KPICheckResult {
  return (state) => {
    const results = checks.map(c => c(state));
    const anyMet = results.some(r => r.met);
    return {
      met: anyMet,
      evidence: results.map(r => r.evidence).join('; '),
    };
  };
}
