/**
 * @method/fca-index — FCA-Indexed Context Library
 *
 * Public API. Exports port interfaces and canonical types.
 * The createFcaIndex() factory is added in Wave 4 (C-6).
 *
 * See docs/prds/053-fca-index-library.md for full specification.
 */

// External port interfaces (frozen — see co-design records)
export type {
  ContextQueryPort,
  ContextQueryRequest,
  ContextQueryResult,
  ComponentContext,
  ComponentPart,
  FcaLevel,
  FcaPart,
  IndexMode,
  ContextQueryError,
} from './ports/context-query.js';

export type {
  ManifestReaderPort,
  ProjectScanConfig,
  ManifestReaderError,
} from './ports/manifest-reader.js';

export type {
  CoverageReportPort,
  CoverageReportRequest,
  CoverageReport,
  CoverageSummary,
  ComponentCoverageEntry,
  CoverageReportError,
} from './ports/coverage-report.js';

// Factory
export { createFcaIndex } from './factory.js';
export type { FcaIndex, FcaIndexConfig, FcaIndexPorts } from './factory.js';
