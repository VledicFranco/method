// SPDX-License-Identifier: Apache-2.0
/**
 * EventRotator — archives events older than a cutoff window to keep the log bounded.
 *
 * Rotation compacts the main event log (`.method/events.jsonl`) by moving old
 * events into gzipped daily archives (`.method/events.archive/YYYY-MM-DD.jsonl.gz`).
 *
 * Safety contract: rotation MUST NOT cross the cursor returned by safetyGuard —
 * doing so would strand projection snapshots that haven't yet caught up, breaking
 * their ability to recover on next restart.
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md §Surfaces S-rotator
 */

export interface EventRotator {
  /** Archive events older than the cutoff, after checking rotation is safe. */
  rotate(options: RotateOptions): Promise<RotateResult>;
}

export interface RotateOptions {
  /** Archive events older than this many days. */
  readonly olderThanDays: number;
  /**
   * Safety guard — returns the lowest cursor below which rotation is safe.
   * Returns null if rotation is unsafe at any cursor (e.g. no projections registered).
   * Called by rotate() before any archive operation.
   */
  readonly safetyGuard: () => number | null;
}

export interface RotateResult {
  /** Number of events moved to the archive file. */
  readonly archivedEvents: number;
  /** Path to the written archive file, or null if no events were archived. */
  readonly archivePath: string | null;
  /** Size of the main log after rotation, in bytes. */
  readonly newLogSize: number;
  /** True if the safety guard blocked rotation (archivedEvents will be 0). */
  readonly skipped: boolean;
  /** Human-readable reason when `skipped` is true. */
  readonly skipReason?: string;
}
