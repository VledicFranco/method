/**
 * scanner/ — FCA component detection and coverage scoring domain.
 *
 * ProjectScanner: walks the project using configurable sourcePatterns and
 *   excludePatterns (defaulting to exclude __tests__/, *.test.ts, *.spec.ts, *.d.ts),
 *   detects FCA components (directories with index.ts or 2+ .ts files), and
 *   delegates to FcaDetector + CoverageScorer for part analysis.
 *
 * FcaDetector: for each candidate directory, identifies which of the 8 FCA parts
 *   are present (interface, documentation, port, boundary, domain, architecture,
 *   verification, observability) and extracts excerpts for embedding.
 *
 * CoverageScorer: given present parts vs. required parts, computes a 0–1 coverage
 *   score. Default required: ['interface', 'documentation'].
 *
 * DocExtractor: reads file content and extracts the leading JSDoc block or first
 *   paragraph of a Markdown file as the part excerpt.
 */

export { ProjectScanner } from './project-scanner.js';
export type { ScannedComponent } from './project-scanner.js';
export { FcaDetector } from './fca-detector.js';
export { CoverageScorer } from './coverage-scorer.js';
export { DocExtractor } from './doc-extractor.js';
