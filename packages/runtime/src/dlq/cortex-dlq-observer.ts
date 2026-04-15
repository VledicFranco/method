/**
 * CortexDlqObserver — external DLQ emission path for PactDeadLetterEvent.
 *
 * PRD-062 / S5 §2.4 + §7. Coordinates single-emit (gate G-DLQ-SINGLE-EMIT)
 * with the `CortexJobBackedExecutor` so that each sessionId emits at most
 * ONE `PactDeadLetterEvent` across the union of inline + external paths.
 */

import type { PactDeadLetterEvent } from '@method/pacta';
import type { ContinuationEnvelope } from '../ports/continuation-envelope.js';
import type {
  DlqObserver,
  DlqRecord,
} from '../ports/dlq-observer.js';
import type { CortexJobBackedExecutor } from '../executors/cortex-job-backed-executor.js';

export interface CortexDlqObserverOptions {
  executor: CortexJobBackedExecutor;
  emitAgentEvent?: (event: PactDeadLetterEvent) => void;
}

export class CortexDlqObserver implements DlqObserver {
  private readonly executor: CortexJobBackedExecutor;
  private readonly emit?: (event: PactDeadLetterEvent) => void;

  constructor(options: CortexDlqObserverOptions) {
    this.executor = options.executor;
    this.emit = options.emitAgentEvent;
  }

  async onDeadLetter(
    envelope: ContinuationEnvelope,
    record: DlqRecord,
  ): Promise<PactDeadLetterEvent | null> {
    if (await this.executor.isDlqEmitted(envelope.sessionId)) {
      return null;
    }
    // Delegate to the executor so the emission + finalization path stays
    // centralised. The executor persists the DLQ-emitted flag, so
    // subsequent calls for the same sessionId return null.
    const event = await this.executor.emitInlineDeadLetter(
      envelope,
      record.lastError,
      record.attempts,
    );
    if (event && this.emit) this.emit(event);
    return event;
  }
}
