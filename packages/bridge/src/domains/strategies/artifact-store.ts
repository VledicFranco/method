/**
 * PRD 017: Strategy Pipelines — Artifact Store
 *
 * WS-2: Now a thin re-export from @method/methodts canonical artifact store.
 * All artifact store logic (immutable versioned store, snapshots) lives in
 * methodts. This file preserves the bridge's import surface for backward
 * compatibility.
 */

// Re-export types
export type {
  ArtifactVersion,
  ArtifactBundle,
  ArtifactStore,
} from '@method/methodts/strategy/dag-types.js';

// Re-export implementations
export {
  InMemoryArtifactStore,
  createArtifactStore,
} from '@method/methodts/strategy/dag-artifact-store.js';
