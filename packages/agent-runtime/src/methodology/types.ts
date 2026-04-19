// SPDX-License-Identifier: Apache-2.0
/**
 * Data-shape types for the CortexMethodologySource.
 *
 * Owns:
 *   - `MethodologyDocument`      — persisted Mongo doc (whole-document shape, S7 §4.1)
 *   - `MethodologyDocumentInput` — admin upsert payload (PRD-064 §7.1)
 *   - `MethodologyPolicy`        — singleton per-app policy doc (S7 §4.2)
 *   - `CompilationReport`        — the G1-G6 (+G7 pending) write-time report
 *   - `MethodologyDocumentSummary` — lean row for list-view UX (PRD-064 §9)
 *
 * These are **structural** types. The Cortex storage port accepts them by
 * shape; no runtime SDK dependency is introduced by importing them.
 */

/** Per-methodology gate result. */
export interface CompilationGateResult {
  readonly gate: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
  readonly status: 'pass' | 'fail' | 'needs_review' | 'pending';
  readonly details: string;
}

/** Compilation report persisted on every document. */
export interface CompilationReport {
  readonly overall: 'compiled' | 'failed' | 'needs_review';
  readonly gates: ReadonlyArray<CompilationGateResult>;
  readonly compiledAt: string; // ISO-8601
  readonly methodtsVersion: string;
}

/** Methodology inheritance mode. */
export type MethodologyInheritance =
  | 'stdlib-plus-overrides'
  | 'per-app-only'
  | 'stdlib-read-only';

/** Extracted metadata for cheap list() queries without re-parsing YAML. */
export interface MethodologyMetadata {
  readonly name: string;
  readonly description: string;
  readonly methods: ReadonlyArray<{
    readonly methodId: string;
    readonly name: string;
    readonly description: string;
    readonly stepCount: number;
    readonly status: 'compiled' | 'draft';
    readonly version: string;
  }>;
}

/**
 * Persisted methodology document. One document per methodologyId,
 * `_id == methodologyId`. Stored in the `methodologies` collection.
 */
export interface MethodologyDocument {
  readonly _id: string;
  readonly methodologyId: string;
  readonly version: string;
  readonly source: 'stdlib-pinned' | 'per-app';
  readonly parent?: {
    readonly methodologyId: string;
    readonly stdlibVersion: string;
  };
  readonly status: 'compiled' | 'draft' | 'deprecated';
  readonly yaml: string;
  readonly metadata: MethodologyMetadata;
  readonly compilationReport: CompilationReport;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /** Structural index signature so the doc satisfies the generic
   *  `Readonly<Record<string, unknown>>` constraint of StorageCollection. */
  readonly [extra: string]: unknown;
}

/** Input shape for admin upsert. Server derives version/status/report. */
export interface MethodologyDocumentInput {
  readonly methodologyId: string;
  readonly yaml: string;
  /** User id from Cortex auth — supplied by the route layer. */
  readonly updatedBy?: string;
  /**
   * Optional — when set, `upsert` accepts a `needs_review` G5 without
   * marking the doc deprecated.
   */
  readonly allowNeedsReview?: boolean;
}

/** Lean row for the list-view UX (PRD-064 §9). */
export interface MethodologyDocumentSummary {
  readonly methodologyId: string;
  readonly version: string;
  readonly source: 'stdlib' | 'stdlib-pinned' | 'per-app' | 'pinned-drifted';
  readonly status: 'compiled' | 'draft' | 'deprecated';
  readonly gateSummary: {
    readonly overall: 'compiled' | 'failed' | 'needs_review' | 'not-run';
    readonly failingGates: ReadonlyArray<string>;
  };
}

/**
 * Per-app policy singleton. `_id == 'policy'` (fixed). Kept in its own
 * collection so the admin UI can update it atomically.
 */
export interface MethodologyPolicy {
  readonly _id: 'policy';
  readonly inheritance: MethodologyInheritance;
  readonly enabledMethodologies?: ReadonlyArray<string>;
  readonly defaultMethodologyId?: string;
  readonly roleToMethodology?: Readonly<Record<string, string>>;
  readonly stdlibPin?: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly [extra: string]: unknown;
}

/** Error codes emitted by CortexMethodologySource admin methods. */
export type CortexMethodologyErrorCode =
  | 'METHODOLOGY_PARSE_ERROR'
  | 'METHODOLOGY_GATE_FAIL'
  | 'METHODOLOGY_TOO_LARGE'
  | 'POLICY_READ_ONLY'
  | 'POLICY_DEMOTION_REJECTED'
  | 'STDLIB_ENTRY_NOT_REMOVABLE'
  | 'STDLIB_ENTRY_NOT_FOUND';
