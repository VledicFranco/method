// SPDX-License-Identifier: Apache-2.0
/**
 * ports/ — Public port interfaces for @methodts/fca-index.
 *
 * External ports (frozen, co-designed with consumers):
 *   - ContextQueryPort: semantic search — query → ranked ComponentContext list
 *   - CoverageReportPort: coverage analysis — projectRoot → CoverageReport
 *   - ManifestReaderPort: config reader — .fca-index.yaml → ProjectScanConfig
 *
 * New ports (Feature Sets B & C, frozen 2026-04-08):
 *   - ComponentDetailPort: full component detail — path → interface + docText + part locations
 *   - ComplianceSuggestionPort: FCA stub generator — path → missing parts + template content
 *
 * Internal ports (implementation isolation only — not part of the public API):
 *   See ports/internal/ for FileSystemPort, EmbeddingClientPort, IndexStorePort.
 */

export type { ContextQueryPort, ContextQueryRequest, ContextQueryResult, ComponentContext, ComponentPart, ContextQueryError } from './context-query.js';
export type { CoverageReportPort, CoverageReportRequest, CoverageReport, CoverageSummary, ComponentCoverageEntry, CoverageReportError } from './coverage-report.js';
export type { ManifestReaderPort, ProjectScanConfig, ManifestReaderError } from './manifest-reader.js';
export type { ComponentDetailPort, ComponentDetail, ComponentDetailError } from './component-detail.js';
export type { ComplianceSuggestionPort, ComplianceSuggestion, PartSuggestion, ComplianceSuggestionError } from './compliance-suggestion.js';
