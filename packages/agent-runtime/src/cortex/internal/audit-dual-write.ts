// SPDX-License-Identifier: Apache-2.0
/**
 * Audit dual-write — the permanent-failure safety net.
 *
 * When `CortexEventConnector` experiences a permanent publish failure
 * (schema-rejected, topic-unknown, buffer-drop permanent), it writes a
 * synthetic audit record via `ctx.audit.event` so the compliance path
 * always contains a record of the events-path gap.
 *
 * Shape (S6 §4.3):
 *   {
 *     eventType: 'method.infrastructure.events_publish_failed',
 *     payload: {
 *       topic, reason, runtimeEventId, retryCount, detail
 *     },
 *     severity: 'warning'
 *   }
 *
 * Fire-and-forget: a failure inside `writeAudit` is caught + logged,
 * never propagated. The connector cannot take down its caller.
 */

import type { CortexAuditFacade, CortexLogger } from '../ctx-types.js';

export interface DualWriteReason {
  readonly topic: string;
  readonly reason: string;
  readonly runtimeEventId: string;
  readonly runtimeEventType: string;
  readonly retryCount: number;
  readonly statusCode?: number;
  readonly detail?: string;
}

export interface DualWriteDeps {
  readonly audit?: CortexAuditFacade;
  readonly logger?: CortexLogger;
  readonly appId: string;
  readonly enabled: boolean;
}

/**
 * Write the synthetic events-publish-failed audit record. Never throws.
 */
export async function dualWriteAuditOnFailure(
  deps: DualWriteDeps,
  reason: DualWriteReason,
): Promise<void> {
  if (!deps.enabled) return;
  if (!deps.audit) {
    deps.logger?.debug?.(
      'cortex-event-connector: dual-write skipped (no ctx.audit)',
      { topic: reason.topic, reason: reason.reason },
    );
    return;
  }
  try {
    const maybe = deps.audit.event({
      eventType: 'method.infrastructure.events_publish_failed',
      actor: { appId: deps.appId },
      payload: {
        topic: reason.topic,
        reason: reason.reason,
        runtimeEventId: reason.runtimeEventId,
        runtimeEventType: reason.runtimeEventType,
        retryCount: reason.retryCount,
        statusCode: reason.statusCode ?? null,
        detail: reason.detail ?? null,
      },
    });
    if (maybe && typeof (maybe as Promise<void>).then === 'function') {
      await (maybe as Promise<void>);
    }
  } catch (err) {
    deps.logger?.warn?.(
      'cortex-event-connector: audit dual-write threw',
      {
        topic: reason.topic,
        reason: reason.reason,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}
