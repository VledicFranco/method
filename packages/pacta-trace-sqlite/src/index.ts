// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/pacta-trace-sqlite — SQLite-backed TraceStore for PRD 058.
 *
 * Implements the canonical TraceStore + TraceSink ports from
 * @methodts/pacta over a better-sqlite3 backing store. Pacta's
 * G-PORT gate forbids native deps in the framework package; this
 * sibling package isolates the binary dependency.
 *
 * @see ../../pacta/src/cognitive/algebra/trace-store.ts
 * @see docs/prds/058-hierarchical-trace-observability.md
 */

export { SqliteTraceStore } from './sqlite-store.js';
export type { SqliteTraceStoreOptions } from './sqlite-store.js';
