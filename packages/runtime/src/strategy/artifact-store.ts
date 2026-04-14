/**
 * PRD 017: Strategy Pipelines — Artifact Store
 *
 * Re-export from @method/methodts canonical artifact store. All artifact-store
 * logic (immutable versioned store, snapshots) lives in methodts. This file
 * preserves the runtime's import surface.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/.
 */

export type {
  ArtifactVersion,
  ArtifactBundle,
  ArtifactStore,
} from '@method/methodts/strategy/dag-types.js';

export {
  InMemoryArtifactStore,
  createArtifactStore,
} from '@method/methodts/strategy/dag-artifact-store.js';
