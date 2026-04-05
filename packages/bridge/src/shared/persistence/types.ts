/**
 * Canonical types for projection-based persistence.
 *
 * ProjectionSnapshot is the on-disk format written to `.method/projections/{domain}.json`.
 * It pairs a projection's serialized state with the event cursor at which that state
 * was captured, so the ProjectionStore can resume event replay from the correct point.
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md §Surfaces S4
 */

export interface ProjectionSnapshot {
  /** Schema version for forward compatibility. */
  readonly version: 1;
  /** Domain name — matches Projection.domain. */
  readonly domain: string;
  /** Highest event.sequence included in state at the time of snapshot. */
  readonly cursor: number;
  /** Total events reduced — useful for diagnostics and drift detection. */
  readonly eventCount: number;
  /** ISO 8601 timestamp of snapshot write. */
  readonly writtenAt: string;
  /** projection.serialize(state) output. */
  readonly state: string;
}
