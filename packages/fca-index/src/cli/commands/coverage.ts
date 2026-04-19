// SPDX-License-Identifier: Apache-2.0
/**
 * coverage command — FCA documentation coverage report.
 */

import type { CoverageReportPort, CoverageReportRequest } from '../../ports/coverage-report.js';

export async function runCoverageCommand(
  coveragePort: CoverageReportPort,
  request: CoverageReportRequest,
): Promise<void> {
  const report = await coveragePort.getReport(request);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  // Exit with non-zero code in CI when coverage is below threshold.
  // Print first so CI logs capture the report before the process exits.
  if (!report.summary.meetsThreshold) {
    process.exit(1);
  }
}
