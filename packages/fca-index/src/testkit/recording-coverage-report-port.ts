// SPDX-License-Identifier: Apache-2.0
/**
 * RecordingCoverageReportPort — Test double for CoverageReportPort.
 *
 * Records calls and returns configurable stub reports.
 * Use in @methodts/mcp tests that consume CoverageReportPort.
 *
 * Part of @methodts/fca-index/testkit — not included in production bundle.
 */

import type { CoverageReportPort, CoverageReportRequest, CoverageReport, CoverageSummary } from '../ports/coverage-report.js';

const DEFAULT_SUMMARY: CoverageSummary = {
  totalComponents: 0,
  overallScore: 0,
  threshold: 0.8,
  meetsThreshold: false,
  fullyDocumented: 0,
  partiallyDocumented: 0,
  undocumented: 0,
  byPart: {
    interface: 0, boundary: 0, port: 0, domain: 0,
    architecture: 0, verification: 0, observability: 0, documentation: 0,
  },
};

export class RecordingCoverageReportPort implements CoverageReportPort {
  readonly calls: CoverageReportRequest[] = [];
  private readonly stubReport: Partial<CoverageReport>;

  constructor(stub: Partial<CoverageReport> = {}) {
    this.stubReport = stub;
  }

  async getReport(request: CoverageReportRequest): Promise<CoverageReport> {
    this.calls.push(request);
    return {
      projectRoot: request.projectRoot,
      mode: 'discovery',
      generatedAt: new Date().toISOString(),
      summary: DEFAULT_SUMMARY,
      ...this.stubReport,
    };
  }

  assertCallCount(n: number): void {
    if (this.calls.length !== n) {
      throw new Error(`Expected ${n} calls to CoverageReportPort.getReport, got ${this.calls.length}`);
    }
  }
}
