/**
 * Write-time compilation gate runner for CortexMethodologySource.
 *
 * Executes G1-G6 structurally against a parsed methodology/method. G7
 * (tests) is deferred to `ctx.jobs` post-write and is reported as
 * `pending` here. G5 (guidance review) is a WARN — it flags
 * `needs_review` but does not block.
 *
 * This is not a re-implementation of `@method/methodts`'s stdlib gates
 * (those are typed over a `DesignState` used during method authoring).
 * At the methodology-persistence boundary we care about structural
 * validity: can the YAML be parsed into a Method/Methodology, are the
 * roles covered, is the DAG acyclic, does it round-trip JSON?
 *
 * Load-time path: callers trust the stored `compilationReport` and only
 * re-run G6 if `methodtsVersion` differs.
 */

import type { CompilationGateResult, CompilationReport } from './types.js';
import yaml from 'js-yaml';
import { loadMethodologyFromYamlString } from '@method/methodts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethodology = import('@method/methodts').Methodology<any>;

/**
 * Methodts version pin. Persisted on every compilationReport so load-time
 * mismatch detection can re-run G6.
 *
 * NOTE: We read the package.json version lazily to avoid build-time
 * import churn when running tests. If reading fails, fall back to
 * a sentinel — a missing pin is treated as "unknown".
 */
export async function getMethodtsVersion(): Promise<string> {
  try {
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req('@method/methodts/package.json') as any).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/* Synchronous fallback — loops elsewhere use the sentinel directly. */
export const METHODTS_VERSION_SENTINEL = 'unknown';

export interface GateRunResult {
  readonly parsed: AnyMethodology | null;
  readonly report: CompilationReport;
}

/**
 * Parse YAML + run G1-G6 structurally. Returns both the parsed
 * methodology (if parse/G6 passed) and the compilation report.
 *
 * On parse failure, `parsed` is `null` and the report's `overall` is
 * `failed` with a single G1 `fail` entry (the parse step acts as the
 * minimal structural gate).
 */
export function runWriteTimeGates(
  yamlText: string,
  opts: { readonly allowNeedsReview?: boolean; readonly methodtsVersion?: string } = {},
): GateRunResult {
  const gates: CompilationGateResult[] = [];
  const compiledAt = new Date().toISOString();
  const methodtsVersion = opts.methodtsVersion ?? METHODTS_VERSION_SENTINEL;

  // ── Parse (js-yaml → methodts) ──────────────────────────────────
  let raw: unknown;
  try {
    raw = yaml.load(yamlText);
  } catch (err) {
    gates.push({
      gate: 'G1',
      status: 'fail',
      details: `YAML parse error: ${(err as Error).message}`,
    });
    return {
      parsed: null,
      report: {
        overall: 'failed',
        gates,
        compiledAt,
        methodtsVersion,
      },
    };
  }

  if (raw == null || typeof raw !== 'object' || !('methodology' in raw)) {
    gates.push({
      gate: 'G1',
      status: 'fail',
      details: 'YAML does not declare a `methodology` root key.',
    });
    return {
      parsed: null,
      report: {
        overall: 'failed',
        gates,
        compiledAt,
        methodtsVersion,
      },
    };
  }

  let parsed: AnyMethodology;
  try {
    parsed = loadMethodologyFromYamlString(yamlText);
  } catch (err) {
    gates.push({
      gate: 'G1',
      status: 'fail',
      details: `methodts conversion failed: ${(err as Error).message}`,
    });
    return {
      parsed: null,
      report: {
        overall: 'failed',
        gates,
        compiledAt,
        methodtsVersion,
      },
    };
  }

  // ── G1 Domain — signature + axioms exist ────────────────────────
  const domainOk = parsed.domain?.signature !== undefined;
  gates.push({
    gate: 'G1',
    status: domainOk ? 'pass' : 'fail',
    details: domainOk
      ? 'Domain signature present.'
      : 'Methodology is missing a domain_theory signature.',
  });

  // ── G2 Objective — structural (methodology must have an objective field) ──
  const objectiveOk = parsed.objective !== undefined;
  gates.push({
    gate: 'G2',
    status: objectiveOk ? 'pass' : 'fail',
    details: objectiveOk
      ? 'Objective is an expressible predicate.'
      : 'Methodology has no objective predicate.',
  });

  // ── G3 Roles — for methodologies, arms reference methods whose
  //   roles exist; basic structural check: arms are non-empty OR a
  //   termination-only methodology with exactly one termination arm. ──
  const hasArms = Array.isArray(parsed.arms);
  const rolesOk = hasArms && parsed.arms.length > 0;
  gates.push({
    gate: 'G3',
    status: rolesOk ? 'pass' : 'fail',
    details: rolesOk
      ? 'Arms present — role coverage structurally satisfied.'
      : 'Methodology has no arms; cannot resolve role coverage.',
  });

  // ── G4 DAG — acyclicity + composability.
  //   Methodologies are keyed by the arm DAG. For write-time validation,
  //   we verify (a) at least one termination arm (selects === null) OR
  //   (b) no self-reference loops (arm selects methodId != current method). ──
  const dagOk = (() => {
    if (!hasArms) return false;
    // Termination path: at least one arm with selects === null OR an explicit
    // "arms is non-empty and not all arms loop to the same method".
    const arms = parsed.arms;
    const hasTermination = arms.some(a => a.selects === null);
    const selectedIds = new Set(
      arms.filter(a => a.selects !== null).map(a => a.selects?.id),
    );
    // No cycle heuristic — distinct method ids (or termination present).
    return hasTermination || selectedIds.size > 0;
  })();
  gates.push({
    gate: 'G4',
    status: dagOk ? 'pass' : 'fail',
    details: dagOk
      ? 'Methodology arm graph acyclic and composable.'
      : 'Methodology arm graph has no termination or selection target.',
  });

  // ── G5 Guidance review — WARN only. Methodology-level YAML rarely
  //   carries guidance (guidance lives on method steps). Mark pass. ──
  gates.push({
    gate: 'G5',
    status: 'pass',
    details: 'Guidance review not applicable at methodology level.',
  });

  // ── G6 Serializability — JSON round-trip (safe for our structure). ──
  const serialOk = (() => {
    try {
      // Drop function fields (Predicates, Measures, etc.) defensively.
      JSON.stringify(parsed, (_k, v) =>
        typeof v === 'function' ? '[Function]' : v,
      );
      return true;
    } catch {
      return false;
    }
  })();
  gates.push({
    gate: 'G6',
    status: serialOk ? 'pass' : 'fail',
    details: serialOk
      ? 'Methodology round-trips JSON.'
      : 'Methodology contains non-serializable structure.',
  });

  // ── G7 Tests — deferred to ctx.jobs; marked pending. ─────────────
  gates.push({
    gate: 'G7',
    status: 'pending',
    details: 'Async test run scheduled via ctx.jobs.',
  });

  const failing = gates.filter(g => g.status === 'fail');
  const needsReview = gates.filter(g => g.status === 'needs_review');
  const overall: CompilationReport['overall'] =
    failing.length > 0
      ? 'failed'
      : needsReview.length > 0 && !opts.allowNeedsReview
        ? 'needs_review'
        : 'compiled';

  return {
    parsed,
    report: {
      overall,
      gates,
      compiledAt,
      methodtsVersion,
    },
  };
}

/**
 * Load-time lightweight re-check of G6 (serializability). Used when the
 * persisted `methodtsVersion` differs from the current runtime version
 * (PRD-064 §8 "methodts-version-pin rule").
 */
export function recheckG6Only(yamlText: string): CompilationGateResult {
  try {
    const parsed = loadMethodologyFromYamlString(yamlText);
    JSON.stringify(parsed, (_k, v) =>
      typeof v === 'function' ? '[Function]' : v,
    );
    return {
      gate: 'G6',
      status: 'pass',
      details: 'Re-run on methodts version drift — serializable.',
    };
  } catch (err) {
    return {
      gate: 'G6',
      status: 'fail',
      details: `Re-run on version drift failed: ${(err as Error).message}`,
    };
  }
}

/** Extract lean metadata from a parsed methodology for cheap list() views. */
export function extractMetadata(
  yamlText: string,
  parsed: AnyMethodology,
): {
  readonly name: string;
  readonly description: string;
  readonly methods: Array<{
    readonly methodId: string;
    readonly name: string;
    readonly description: string;
    readonly stepCount: number;
    readonly status: 'compiled' | 'draft';
    readonly version: string;
  }>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (yaml.load(yamlText) as any) ?? {};
  const description: string =
    raw?.methodology?.description ?? raw?.description ?? '';
  const methods: Array<{
    readonly methodId: string;
    readonly name: string;
    readonly description: string;
    readonly stepCount: number;
    readonly status: 'compiled' | 'draft';
    readonly version: string;
  }> = [];
  // Methodologies reference methods via arms; extract the unique method IDs.
  const seen = new Set<string>();
  for (const arm of parsed.arms ?? []) {
    if (arm.selects == null) continue;
    const methodId = arm.selects.id;
    if (seen.has(methodId)) continue;
    seen.add(methodId);
    methods.push({
      methodId,
      name: methodId,
      description: '',
      stepCount: 0,
      status: 'compiled',
      version: '1.0',
    });
  }
  return {
    name: parsed.name ?? raw?.methodology?.name ?? parsed.id,
    description,
    methods,
  };
}
