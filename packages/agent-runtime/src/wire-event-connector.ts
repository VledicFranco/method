/**
 * Optional `CortexEventConnector` auto-wiring (PRD-058 §5 D7, S6).
 *
 * When `ctx.events` is present AND `options.middleware.events !== false`,
 * subscribe a lightweight connector to the events multiplexer that publishes
 * each pacta `AgentEvent` to `ctx.events.publish(topic, payload)`.
 *
 * The full `CortexEventConnector` implementation lands in PRD-063 (S6); this
 * file is the seam. Today it publishes under a fixed topic naming convention
 * (`method.agent.<type>`) and is fire-and-forget (errors logged via ctx.log).
 */

import type { AgentEvent } from '@method/pacta';
import type { CortexCtx } from './cortex/ctx-types.js';

export interface CortexEventConnectorSubscriber {
  (event: AgentEvent): void | Promise<void>;
}

/**
 * Build a subscriber function that forwards every `AgentEvent` to
 * `ctx.events.publish`. Returns `undefined` when ctx.events is absent
 * (caller skips wiring).
 */
export function buildEventConnectorSubscriber(
  ctx: CortexCtx,
  appId: string,
): CortexEventConnectorSubscriber | undefined {
  const eventsFacade = ctx.events;
  if (!eventsFacade) return undefined;
  const logger = ctx.log;

  return (event: AgentEvent): void => {
    const topic = `method.agent.${event.type}`;
    const payload: Record<string, unknown> = {
      ...(event as unknown as Record<string, unknown>),
      appId,
    };
    try {
      const maybePromise = eventsFacade.publish(topic, payload);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        (maybePromise as Promise<void>).catch((err) =>
          logger?.warn?.('agent-runtime: event-connector publish rejected', {
            topic,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } catch (err) {
      logger?.warn?.('agent-runtime: event-connector publish threw', {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
