// SPDX-License-Identifier: Apache-2.0
/**
 * ComponentDetailEngine — ComponentDetailPort implementation.
 *
 * Performs a single path-based lookup in the SQLite index store.
 * No embedding calls — pure metadata retrieval.
 */

import type { ComponentDetailPort, ComponentDetailRequest, ComponentDetail } from '../ports/component-detail.js';
import { ComponentDetailError } from '../ports/component-detail.js';
import type { IndexStorePort } from '../ports/internal/index-store.js';
import type { FcaLevel } from '../ports/context-query.js';

export class ComponentDetailEngine implements ComponentDetailPort {
  constructor(private readonly store: IndexStorePort) {}

  async getDetail(request: ComponentDetailRequest): Promise<ComponentDetail> {
    const { path, projectRoot } = request;

    // Verify the project has any indexed content before attempting the lookup.
    let entry;
    try {
      entry = await this.store.getByPath(path, projectRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComponentDetailError(
        `Failed to look up component '${path}': ${msg}`,
        'LOOKUP_FAILED',
      );
    }

    if (entry === null) {
      // Distinguish between "project not indexed" and "component not found"
      // by checking total component count.
      const stats = await this.store.getCoverageStats(projectRoot);
      if (stats.totalComponents === 0) {
        throw new ComponentDetailError(
          `No index found for project '${projectRoot}'. Run 'fca-index scan' first.`,
          'INDEX_NOT_FOUND',
        );
      }
      throw new ComponentDetailError(
        `Component '${path}' not found in index. Run 'fca-index scan' to update the index.`,
        'NOT_FOUND',
      );
    }

    // Normalise level to uppercase (IndexEntry stores 'L2' etc.)
    const rawLevel = entry.level as string;
    const level = (rawLevel.charAt(0).toUpperCase() + rawLevel.slice(1)) as FcaLevel;

    // Build the full docText from part excerpts (same as what was embedded during scan)
    const docText = entry.parts
      .map((p) => p.excerpt ?? '')
      .filter((e) => e.length > 0)
      .join('\n\n');

    const detail: ComponentDetail = {
      path: entry.path,
      level,
      parts: entry.parts.map((p) => ({
        part: p.part,
        filePath: p.filePath,
        excerpt: p.excerpt,
      })),
      docText,
      indexedAt: entry.indexedAt,
    };

    return detail;
  }
}
