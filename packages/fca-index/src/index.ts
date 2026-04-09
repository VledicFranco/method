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
} from './ports/context-query.js';
// ContextQueryError is a class — export as value so consumers can use `new` and `instanceof`
export { ContextQueryError } from './ports/context-query.js';

export type {
  ManifestReaderPort,
  ProjectScanConfig,
} from './ports/manifest-reader.js';
// ManifestReaderError is a class — export as value
export { ManifestReaderError } from './ports/manifest-reader.js';

export type {
  CoverageReportPort,
  CoverageReportRequest,
  CoverageReport,
  CoverageSummary,
  ComponentCoverageEntry,
} from './ports/coverage-report.js';
// CoverageReportError is a class — export as value so consumers can use `new` and `instanceof`
export { CoverageReportError } from './ports/coverage-report.js';

export type {
  ComponentDetailPort,
  ComponentDetailRequest,
  ComponentDetail,
  ComponentDetailPart,
} from './ports/component-detail.js';
// ComponentDetailError is a class — export as value so consumers can use `new` and `instanceof`
export { ComponentDetailError } from './ports/component-detail.js';

// Factory
export { createFcaIndex } from './factory.js';
export type { FcaIndex, FcaIndexConfig, FcaIndexPorts } from './factory.js';
export { createDefaultFcaIndex } from './factory.js';
export type { DefaultFcaIndexConfig } from './factory.js';
