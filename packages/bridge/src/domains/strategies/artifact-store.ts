/**
 * PRD 017: Strategy Pipelines — Artifact Store
 *
 * Immutable versioned store for pipeline artifacts.
 * Each put() creates a new version; existing versions are never overwritten.
 * Snapshots produce frozen bundles suitable for passing to pipeline nodes.
 */

export interface ArtifactVersion {
  artifact_id: string;
  version: number;
  content: unknown;
  producer_node_id: string;
  timestamp: string;
}

export interface ArtifactBundle {
  [artifact_id: string]: ArtifactVersion;
}

export interface ArtifactStore {
  /** Get the latest version of an artifact, or null if it doesn't exist */
  get(artifact_id: string): ArtifactVersion | null;
  /** Get a specific version (1-indexed), or null if it doesn't exist */
  getVersion(artifact_id: string, version: number): ArtifactVersion | null;
  /** Create a new version of an artifact (never overwrites) */
  put(artifact_id: string, content: unknown, producer: string): ArtifactVersion;
  /** Read-only frozen snapshot of latest versions for passing to nodes */
  snapshot(): ArtifactBundle;
  /** All versions for an artifact, in order */
  history(artifact_id: string): ArtifactVersion[];
}

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

  put(artifact_id: string, content: unknown, producer: string): ArtifactVersion {
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
    const bundle: ArtifactBundle = {};
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

/** Factory function for creating a new ArtifactStore */
export function createArtifactStore(): ArtifactStore {
  return new InMemoryArtifactStore();
}
