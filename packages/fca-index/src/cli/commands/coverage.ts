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
}
