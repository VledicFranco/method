// SPDX-License-Identifier: Apache-2.0
/**
 * ScheduledPact — binds a Cortex-app `schedules[]` entry to a pact factory.
 *
 * PRD-062 / S5 §2.3. Frozen: 2026-04-14.
 *
 * Two usage modes:
 *
 * Declarative (preferred for Wave 1):
 *   ```
 *   cortexApp({
 *     schedules: [{
 *       name: 'daily-twin-report',
 *       cron: '0 9 * * MON-FRI',
 *       job: 'method.pact.continue',
 *       payload: ScheduledPact.payload('daily-twin-report', {
 *         initialContext: { twinId: 'franco' },
 *         budgetStrategy: 'fresh-per-continuation',
 *         perTickBudgetUsd: 2.0,
 *       }),
 *     }],
 *   });
 *   ```
 *
 * Imperative:
 *   ```
 *   await ScheduledPact.bind(ctx.schedule, {
 *     name: 'incident-sla-check',
 *     cron: '* /15 * * * *',
 *     pactKey: 'incident-sla-check',
 *   });
 *   ```
 *
 * The helper's `bind`/`unbind` static methods operate on a `ScheduleClient`
 * port (S5 §2.3). They never import from `@cortex/infra` or
 * `EventBridgeScheduler` — gate `G-BOUNDARY`.
 */

import type { BudgetCarryStrategy } from '../ports/continuation-envelope.js';
import type { ScheduleClient } from '../ports/schedule-client.js';

/**
 * Options passed into `ScheduledPact.payload()`. All optional; defaults
 * documented per field.
 */
export interface ScheduleOptions {
  /** Input context passed to the pact factory on each tick. */
  initialContext?: Record<string, unknown>;
  /** Per-tick budget cap (USD). Overrides pact default. */
  perTickBudgetUsd?: number;
  /** Budget strategy for this scheduled pact. Default `fresh-per-continuation`. */
  budgetStrategy?: BudgetCarryStrategy;
}

/**
 * The JSON payload a Cortex schedule entry carries to instantiate the
 * named pact on tick. Opaque to Cortex; parsed by the runtime handler.
 *
 * The `kind: 'scheduled-pact-tick'` discriminator lets the single
 * `method.pact.continue` handler distinguish synthetic schedule starts
 * from real continuation envelopes.
 */
export interface ScheduledPactPayload {
  kind: 'scheduled-pact-tick';
  pactKey: string;
  initialContext: Record<string, unknown>;
  budgetStrategy: BudgetCarryStrategy;
  perTickBudgetUsd?: number;
}

export interface ScheduleBindOptions {
  name: string;
  cron: string;
  pactKey: string;
  options?: ScheduleOptions;
}

/**
 * ScheduledPact — static helper. Not constructible; used as a namespace.
 */
export const ScheduledPact = {
  /**
   * Build the JSON payload a Cortex schedule entry must carry to instantiate
   * the named pact on tick. Opaque to Cortex; parsed by the runtime handler.
   */
  payload(pactKey: string, options?: ScheduleOptions): ScheduledPactPayload {
    const payload: ScheduledPactPayload = {
      kind: 'scheduled-pact-tick',
      pactKey,
      initialContext: options?.initialContext ?? {},
      budgetStrategy: options?.budgetStrategy ?? 'fresh-per-continuation',
    };
    if (options?.perTickBudgetUsd !== undefined) {
      payload.perTickBudgetUsd = options.perTickBudgetUsd;
    }
    return payload;
  },

  /**
   * Register the schedule at runtime against `ctx.schedule`. Useful for
   * pacts created/destroyed based on runtime state (e.g. user-configured
   * schedules in the Twin UI). Returns the schedule name for later
   * `unbind`.
   */
  async bind(schedules: ScheduleClient, options: ScheduleBindOptions): Promise<string> {
    const payload = ScheduledPact.payload(options.pactKey, options.options);
    await schedules.create(options.name, {
      cron: options.cron,
      job: 'method.pact.continue',
      payload,
    });
    return options.name;
  },

  /** Unbind a previously registered schedule. Idempotent. */
  async unbind(schedules: ScheduleClient, name: string): Promise<void> {
    await schedules.delete(name);
  },
} as const;

/**
 * Type guard — narrows an unknown payload to `ScheduledPactPayload`.
 * Used by the continuation handler to distinguish schedule ticks from
 * regular continuation envelopes.
 */
export function isScheduledPactPayload(payload: unknown): payload is ScheduledPactPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { kind?: unknown; pactKey?: unknown };
  return p.kind === 'scheduled-pact-tick' && typeof p.pactKey === 'string';
}
