// SPDX-License-Identifier: Apache-2.0
/**
 * Strategy DAG Artifact Store — immutable versioned store for pipeline artifacts.
 *
 * Migrated from bridge artifact-store.ts (PRD 017).
 * Each put() creates a new version; existing versions are never overwritten.
 * Snapshots produce frozen bundles suitable for passing to pipeline nodes.
 *
 * @see PRD 017 — Strategy Pipelines (artifact passing)
 */

import type {
  ArtifactVersion,
  ArtifactBundle,
  ArtifactStore,
} from "./dag-types.js";

/**
 * In-memory implementation of the ArtifactStore.
 * Suitable for single-pipeline-execution lifetime.
 */
export class InMemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, ArtifactVersion[]>();

  get(artifact_id: string): ArtifactVersion | null {
    const versions = this.artifacts.get(artifact_id);
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1];
  }

  getVersion(artifact_id: string, version: number): ArtifactVersion | null {
    const versions = this.artifacts.get(artifact_id);
    if (!versions || version < 1 || version > versions.length) return null;
    return versions[version - 1];
  }

  put(
    artifact_id: string,
    content: unknown,
    producer: string,
  ): ArtifactVersion {
    let versions = this.artifacts.get(artifact_id);
    if (!versions) {
      versions = [];
      this.artifacts.set(artifact_id, versions);
    }

    const entry: ArtifactVersion = {
      artifact_id,
      version: versions.length + 1,
      content,
      producer_node_id: producer,
      timestamp: new Date().toISOString(),
    };

    versions.push(entry);
    return entry;
  }

  snapshot(): ArtifactBundle {
    const bundle: Record<string, ArtifactVersion> = {};
    for (const [id, versions] of this.artifacts) {
      if (versions.length > 0) {
        bundle[id] = versions[versions.length - 1];
      }
    }
    return Object.freeze(bundle);
  }

  history(artifact_id: string): ArtifactVersion[] {
    const versions = this.artifacts.get(artifact_id);
    if (!versions) return [];
    return [...versions];
  }
}

/** Factory function for creating a new ArtifactStore. */
export function createArtifactStore(): ArtifactStore {
  return new InMemoryArtifactStore();
}
