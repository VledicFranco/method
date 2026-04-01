/**
 * PRD-044: BridgeHumanApprovalResolver — EventBus-backed HumanApprovalResolver port.
 *
 * Implements the HumanApprovalResolver port from @method/methodts.
 * When a human_approval gate fires:
 *   1. Emits strategy.gate.awaiting_approval on the EventBus (dashboard picks it up)
 *   2. Subscribes to strategy.gate.approval_response waiting for matching execution_id + gate_id
 *   3. Returns the decision (approved/rejected) with optional feedback
 *   4. Resolves with { approved: false, feedback: "...timed out" } after ctx.timeout_ms
 *
 * Transport-agnostic: depends only on EventBus port — no HTTP, WebSocket, or fs imports.
 */

import type { HumanApprovalResolver, HumanApprovalContext, HumanApprovalDecision } from '@method/methodts/strategy/dag-types.js';
import type { EventBus, StrategyGateAwaitingApprovalPayload, StrategyGateApprovalResponsePayload } from '../../ports/event-bus.js';

export class BridgeHumanApprovalResolver implements HumanApprovalResolver {
  constructor(private readonly eventBus: EventBus) {}

  async requestApproval(ctx: HumanApprovalContext): Promise<HumanApprovalDecision> {
    return new Promise<HumanApprovalDecision>((resolve) => {
      let settled = false;

      // Subscribe to approval response events before emitting the request
      // to avoid a race where the response arrives before we're subscribed.
      const subscription = this.eventBus.subscribe(
        { domain: 'strategy', type: 'gate.approval_response' },
        (event) => {
          if (settled) return;

          const payload = event.payload as Partial<StrategyGateApprovalResponsePayload>;
          if (
            payload.execution_id !== ctx.execution_id ||
            payload.gate_id !== ctx.gate_id
          ) {
            // Not for us — continue waiting
            return;
          }

          settled = true;
          clearTimeout(timeoutHandle);
          subscription.unsubscribe();

          const decision = payload.decision;
          if (decision === 'approved') {
            resolve({ approved: true });
          } else {
            // 'rejected' or 'changes_requested' both map to approved: false
            resolve({
              approved: false,
              feedback: payload.feedback,
            });
          }
        },
      );

      // Set up timeout before emitting so it's active even if emit is slow
      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        subscription.unsubscribe();
        resolve({
          approved: false,
          feedback: 'Human approval timed out',
        });
      }, ctx.timeout_ms);

      // Ensure the timer doesn't keep the process alive if the server exits
      if (timeoutHandle && typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
        (timeoutHandle as NodeJS.Timeout).unref();
      }

      // Emit the awaiting_approval event to notify the dashboard
      const awaitingPayload: StrategyGateAwaitingApprovalPayload = {
        strategy_id: ctx.strategy_id,
        execution_id: ctx.execution_id,
        gate_id: ctx.gate_id,
        node_id: ctx.node_id,
        artifact_markdown: ctx.artifact_markdown ?? '',
        artifact_type: ctx.artifact_type ?? 'custom',
        timeout_ms: ctx.timeout_ms,
      };

      try {
        this.eventBus.emit({
          version: 1,
          domain: 'strategy',
          type: 'gate.awaiting_approval',
          severity: 'info',
          payload: awaitingPayload as unknown as Record<string, unknown>,
          source: 'bridge/strategies/human-approval-resolver',
          correlationId: ctx.execution_id,
        });
      } catch {
        // Emit failure must not abort the wait — the subscription is still active
        // and can still receive a response if another code path delivers it.
      }
    });
  }
}
