// SPDX-License-Identifier: Apache-2.0
/**
 * ComplianceEngine — ComplianceSuggestionPort implementation.
 *
 * Looks up a component in the SQLite index, identifies which FCA parts are
 * missing, and generates stub content for each via TemplateGenerator.
 * No embedding calls — pure SQLite lookup + template generation.
 */

import type {
  ComplianceSuggestionPort,
  ComplianceSuggestionRequest,
  ComplianceSuggestion,
  PartSuggestion,
} from '../ports/compliance-suggestion.js';
import { ComplianceSuggestionError } from '../ports/compliance-suggestion.js';
import type { IndexStorePort } from '../ports/internal/index-store.js';
import type { FcaPart } from '../ports/context-query.js';
import { TemplateGenerator } from './template-generator.js';

/** The complete set of FCA parts that every component should ideally cover. */
const ALL_PARTS: FcaPart[] = [
  'interface',
  'boundary',
  'port',
  'domain',
  'architecture',
  'verification',
  'observability',
  'documentation',
];

export class ComplianceEngine implements ComplianceSuggestionPort {
  private readonly generator = new TemplateGenerator();

  constructor(private readonly store: IndexStorePort) {}

  async suggest(request: ComplianceSuggestionRequest): Promise<ComplianceSuggestion> {
    const { path, projectRoot } = request;

    let entry;
    try {
      entry = await this.store.getByPath(path, projectRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComplianceSuggestionError(
        `Failed to look up component '${path}': ${msg}`,
        'SUGGESTION_FAILED',
      );
    }

    if (entry === null) {
      const stats = await this.store.getCoverageStats(projectRoot);
      if (stats.totalComponents === 0) {
        throw new ComplianceSuggestionError(
          `No index found for project '${projectRoot}'. Run 'fca-index scan' first.`,
          'INDEX_NOT_FOUND',
        );
      }
      throw new ComplianceSuggestionError(
        `Component '${path}' not found in index. Run 'fca-index scan' to update the index.`,
        'NOT_FOUND',
      );
    }

    // Determine which parts are present in the index entry.
    const presentParts = new Set<FcaPart>(entry.parts.map((p) => p.part));

    // Generate suggestions for all parts that are missing.
    const missingParts: PartSuggestion[] = [];
    for (const part of ALL_PARTS) {
      if (!presentParts.has(part)) {
        missingParts.push(this.generator.generate(part, path));
      }
    }

    return {
      componentPath: entry.path,
      currentScore: entry.coverageScore,
      missingParts,
    };
  }
}
