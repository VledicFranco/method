// SPDX-License-Identifier: Apache-2.0
/**
 * TraceAssembler — stateful TraceEvent → CycleTrace accumulator.
 *
 * Wave 0 skeleton — implementation lands in Wave 1 (commission C-1).
 * See `docs/prds/058-hierarchical-trace-observability.md` (Surface 2 +
 * Wave 1 plan) and `.method/sessions/fcd-plan-20260425-prd-058-trace/`.
 */

import type { TraceEvent } from '../algebra/trace-events.js';
import type { CycleTrace } from '../algebra/trace-cycle.js';

/**
 * Accumulates TraceEvents grouped by `cycleId`. Returns a `CycleTrace` when
 * a `cycle-end` event is fed; otherwise returns `null`.
 */
export class TraceAssembler {
  /** Cycle ids currently accumulating events (diagnostic). */
  pendingCycleIds(): readonly string[] {
    throw new Error('TraceAssembler: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  /**
   * Feed an event. When the event is `cycle-end`, returns the assembled
   * `CycleTrace`; otherwise returns `null` and buffers the event.
   */
  feed(_event: TraceEvent): CycleTrace | null {
    throw new Error('TraceAssembler: not implemented (PRD-058 Wave 1, commission C-1)');
  }
}
