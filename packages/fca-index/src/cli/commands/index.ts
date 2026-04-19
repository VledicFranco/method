// SPDX-License-Identifier: Apache-2.0
/**
 * cli/commands/ — CLI command runner functions.
 *
 * Each command runner is a pure function: receives a port + options, performs the
 * operation, writes to stdout/stderr, and exits with the appropriate code.
 * No argument parsing here — that lives in cli/index.ts.
 *
 * runScanCommand: triggers a full project scan via Indexer, reports component count.
 * runQueryCommand: runs a semantic query and prints ranked ComponentContext results as JSON.
 * runCoverageCommand: prints CoverageReport as JSON; exits 1 if meetsThreshold is false.
 * runDetailCommand: prints full ComponentDetail (interface + docText + part locations) as JSON.
 * runSuggestCommand: prints FCA compliance stubs; --apply writes files to disk; exits 1 on error.
 */

export { runScanCommand } from './scan.js';
export type { ScanCommandOptions } from './scan.js';
export { runQueryCommand } from './query.js';
export { runCoverageCommand } from './coverage.js';
export { runDetailCommand } from './detail.js';
export { runSuggestCommand } from './suggest.js';
export type { SuggestCommandOptions } from './suggest.js';
