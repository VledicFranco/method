// ── Resource Provider Port ──────────────────────────────────────
//
// How a bridge reports its own machine resources. Implementations
// use os.cpus(), process.memoryUsage(), session pool stats, etc.
// The cluster package never imports node:os or any system API directly.

import type { ResourceSnapshot } from '../types.js';

// Re-export ResourceSnapshot for convenience — consumers importing
// from the ports barrel get the type without a separate import.
export type { ResourceSnapshot } from '../types.js';

/**
 * Port interface for local resource reporting.
 *
 * Implementations are injected at the composition root (L4).
 * The cluster package only depends on this interface, never on
 * platform-specific resource APIs.
 */
export interface ResourceProvider {
  /** Take a point-in-time snapshot of this node's resources. */
  snapshot(): ResourceSnapshot;
}
