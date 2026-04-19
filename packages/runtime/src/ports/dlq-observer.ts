// SPDX-License-Identifier: Apache-2.0
/**
 * DLQ observability port — PRD-062 / S5 §2.4.
 *
 * When Cortex's retry policy exhausts (attempt=4 failed, moved to DLQ),
 * the tenant app MUST give the runtime a chance to observe and emit a
 * terminal `AgentEvent`. This port is attached to the DLQ inspection hook.
 *
 * Two emission paths (G-DLQ-SINGLE-EMIT, S5 §7):
 *   - INLINE: from the continuation handler when pacta classifies "ack +
 *     signal DLQ" (budget exhaustion, checkpoint corruption, budget_expired).
 *   - EXTERNAL: from Cortex's DLQ — the tenant's inspection job calls
 *     `onDeadLetter(envelope, record)` which emits the same event.
 *
 * The observer MUST emit at most one `PactDeadLetterEvent` per
 * `sessionId`, regardless of how many times either path fires. The
 * executor coordinates via SessionStore finalize-status.
 */

import type { ContinuationEnvelope } from './continuation-envelope.js';
import type { PactDeadLetterEvent } from '@methodts/pacta';

export interface DlqObserver {
  /**
   * Called by the tenant app when a DLQ record is observed for a
   * `method.pact.continue` job. The observer unpacks the envelope,
   * emits a `PactDeadLetterEvent` on the host's event channel, and
   * finalises the session (unless already terminal).
   *
   * Returns the emitted event (or `null` if suppressed because the
   * session was already terminal — idempotent).
   */
  onDeadLetter(
    envelope: ContinuationEnvelope,
    dlqRecord: DlqRecord,
  ): Promise<PactDeadLetterEvent | null>;
}

export interface DlqRecord {
  jobId: string;
  attempts: number;
  lastError: string;
  deadLetteredAt: number; // UTC ms
}

/** Re-export for convenient import from the ports barrel. */
export type { PactDeadLetterEvent } from '@methodts/pacta';
