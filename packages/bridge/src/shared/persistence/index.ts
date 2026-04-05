/**
 * Projection-based state persistence library.
 *
 * Provides a uniform pattern for domains to persist in-memory state across
 * bridge restarts by projecting the event log through a pure reducer.
 *
 * Public API exposed here is limited to types. The implementation
 * (ProjectionStore, snapshot I/O) is wired at the composition root.
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md
 */

export type { ProjectionSnapshot } from './types.js';
