/**
 * CoverageEngine — implements CoverageReportPort.
 *
 * Reads the index via IndexStorePort and produces a CoverageReport.
 * Does not touch the filesystem — the index must already exist.
 */

import type { IndexStorePort } from '../ports/internal/index-store.js';
import type { FcaPart } from '../ports/context-query.js';
import type {
  CoverageReportPort,
  CoverageReportRequest,
  CoverageReport,
  CoverageSummary,
  ComponentCoverageEntry,
} from '../ports/coverage-report.js';
import { CoverageReportError } from '../ports/coverage-report.js';
import { detectMode } from './mode-detector.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface CoverageEngineConfig {
  /** Coverage threshold. @default 0.8 */
  threshold?: number;

  /**
   * FCA parts required for full documentation.
   * Used to compute missingParts per component.
   * @default ['interface', 'documentation']
   */
  requiredParts?: FcaPart[];
}

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_REQUIRED_PARTS: FcaPart[] = ['interface', 'documentation'];

// ── Engine ───────────────────────────────────────────────────────────────────

export class CoverageEngine implements CoverageReportPort {
  constructor(
    private readonly store: IndexStorePort,
    private readonly config: CoverageEngineConfig = {},
  ) {}

  async getReport(request: CoverageReportRequest): Promise<CoverageReport> {
    const threshold = this.config.threshold ?? DEFAULT_THRESHOLD;
    const requiredParts = this.config.requiredParts ?? DEFAULT_REQUIRED_PARTS;

    // 1. Fetch aggregate stats.
    const stats = await this.store.getCoverageStats(request.projectRoot);

    // 2. Guard: no components means the index doesn't exist for this project.
    if (stats.totalComponents === 0) {
      throw new CoverageReportError('No index found for project', 'INDEX_NOT_FOUND');
    }

    // 3. Fetch all entries (needed for bucket counts and verbose output).
    const allEntries = await this.store.queryByFilters({ projectRoot: request.projectRoot });

    // 4. Compute bucket counts.
    let fullyDocumented = 0;
    let partiallyDocumented = 0;
    let undocumented = 0;

    for (const entry of allEntries) {
      if (entry.coverageScore === 1.0) {
        fullyDocumented++;
      } else if (entry.coverageScore === 0) {
        undocumented++;
      } else {
        partiallyDocumented++;
      }
    }

    // 5. Determine mode.
    const overallScore = stats.weightedAverage;
    const mode = detectMode(overallScore, threshold);

    // 6. Build summary.
    const summary: CoverageSummary = {
      totalComponents: stats.totalComponents,
      overallScore,
      threshold,
      meetsThreshold: overallScore >= threshold,
      fullyDocumented,
      partiallyDocumented,
      undocumented,
      byPart: stats.byPart,
    };

    // 7. Build per-component breakdown when verbose=true.
    let components: ComponentCoverageEntry[] | undefined;

    if (request.verbose === true) {
      components = allEntries
        .map((entry): ComponentCoverageEntry => {
          const presentParts: FcaPart[] = entry.parts.map((p) => p.part);
          const missingParts: FcaPart[] = requiredParts.filter((p) => !presentParts.includes(p));

          return {
            path: entry.path,
            level: entry.level,
            coverageScore: entry.coverageScore,
            presentParts,
            missingParts,
          };
        })
        .sort((a, b) => a.coverageScore - b.coverageScore);
    }

    // 8. Return the report.
    return {
      projectRoot: request.projectRoot,
      mode,
      generatedAt: new Date().toISOString(),
      summary,
      components,
    };
  }
}
