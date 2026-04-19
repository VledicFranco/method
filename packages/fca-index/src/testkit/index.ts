// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/fca-index/testkit — Test doubles for fca-index port interfaces.
 *
 * Re-exports recording doubles suitable for use in consumer package tests
 * (e.g. @methodts/mcp). These are not included in the production bundle.
 *
 * Mapped to the "./testkit" export in package.json.
 */

export { RecordingContextQueryPort } from './recording-context-query-port.js';
export { RecordingCoverageReportPort } from './recording-coverage-report-port.js';
export { RecordingComponentDetailPort } from './recording-component-detail-port.js';
