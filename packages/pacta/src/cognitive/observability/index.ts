// SPDX-License-Identifier: Apache-2.0
/**
 * cognitive/observability — barrel export.
 *
 * Hierarchical trace observability: assembler, ring buffer, SQLite store.
 * Wave 0 ships skeletons; Waves 1-2 fill in the implementations.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md
 */

export { TraceAssembler } from './assembler.js';
export { TraceRingBuffer } from './ring-buffer.js';
export type { TraceRingBufferOptions } from './ring-buffer.js';

// SqliteTraceStore lives in @methodts/pacta-trace-sqlite (sibling package).
// Pacta's G-PORT gate forbids native deps in the framework package, so the
// SQLite implementation is isolated to its own package. Import path:
//   import { SqliteTraceStore } from '@methodts/pacta-trace-sqlite';
