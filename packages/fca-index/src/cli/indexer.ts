// SPDX-License-Identifier: Apache-2.0
/**
 * Indexer — scan→embed→upsert pipeline.
 *
 * Bridges ProjectScanner (produces ScannedComponent[]) and IndexStore
 * (needs IndexEntry[] with embeddings). Embeddings are computed in batches
 * to respect API rate limits.
 */

import type { IndexStorePort, IndexEntry } from '../ports/internal/index-store.js';
import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import type { ProjectScanner, ScannedComponent } from '../scanner/project-scanner.js';
import type { ManifestReaderPort } from '../ports/manifest-reader.js';

export interface IndexerConfig {
  /** Number of components to embed in a single API call. @default 20 */
  batchSize?: number;
}

export class Indexer {
  constructor(
    private readonly scanner: ProjectScanner,
    private readonly embedder: EmbeddingClientPort,
    private readonly store: IndexStorePort,
    private readonly manifestReader: ManifestReaderPort,
    private readonly config: IndexerConfig = {},
  ) {}

  /**
   * Scan the project, embed documentation, and upsert into the index.
   * Clears the existing index for this project before scanning so the result
   * reflects the current filesystem state.
   *
   * @returns The number of components indexed.
   */
  async index(projectRoot: string): Promise<{ componentCount: number }> {
    const scanConfig = await this.manifestReader.read(projectRoot);

    // Clear existing index for this project before fresh scan
    await this.store.clear(projectRoot);

    // Scan
    const components = await this.scanner.scan(scanConfig);

    // Embed in batches and upsert
    const batchSize = this.config.batchSize ?? 20;
    for (let i = 0; i < components.length; i += batchSize) {
      const batch = components.slice(i, i + batchSize);
      await this.embedAndUpsertBatch(batch);
    }

    return { componentCount: components.length };
  }

  private async embedAndUpsertBatch(components: ScannedComponent[]): Promise<void> {
    // Fall back to the file path when no docText is available (no documented excerpts found)
    const texts = components.map((c) => c.docText || c.path);
    const embeddings = await this.embedder.embed(texts);

    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      const embedding = embeddings[i];

      const entry: IndexEntry = {
        id: component.id,
        projectRoot: component.projectRoot,
        path: component.path,
        level: component.level,
        parts: component.parts.map((p) => ({
          part: p.part,
          filePath: p.filePath,
          excerpt: p.excerpt,
        })),
        coverageScore: component.coverageScore,
        embedding,
        indexedAt: component.indexedAt,
      };

      await this.store.upsertComponent(entry);
    }
  }
}
