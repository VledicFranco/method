// PRD-057 / S2 §3.6: @method/runtime/config — strategies configuration schema.
// Moved from packages/bridge/src/domains/strategies/config.ts.

import { z } from 'zod';

export const StrategiesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxParallel: z.number().default(3),
  defaultGateRetries: z.number().default(3),
  defaultTimeoutMs: z.number().default(600000),
  defaultBudgetUsd: z.number().default(5),
  retroDir: z.string().default('.method/retros'),
  executionTtlMs: z.number().default(3600000),
  maxExecutions: z.number().default(50),
});

export type StrategiesConfig = z.infer<typeof StrategiesConfigSchema>;

/**
 * PRD-057: alias exported for compatibility with the existing
 * `StrategyExecutorConfig` name used by bridge's strategy-routes. Consumers
 * can use either identifier.
 */
export type StrategyExecutorConfig = StrategiesConfig;

export function loadStrategiesConfig(): StrategiesConfig {
  return StrategiesConfigSchema.parse({
    enabled: process.env.STRATEGY_ENABLED !== undefined
      ? process.env.STRATEGY_ENABLED !== 'false'
      : undefined,
    maxParallel: process.env.STRATEGY_MAX_PARALLEL
      ? parseInt(process.env.STRATEGY_MAX_PARALLEL, 10)
      : undefined,
    defaultGateRetries: process.env.STRATEGY_DEFAULT_GATE_RETRIES
      ? parseInt(process.env.STRATEGY_DEFAULT_GATE_RETRIES, 10)
      : undefined,
    defaultTimeoutMs: process.env.STRATEGY_DEFAULT_TIMEOUT_MS
      ? parseInt(process.env.STRATEGY_DEFAULT_TIMEOUT_MS, 10)
      : undefined,
    defaultBudgetUsd: process.env.STRATEGY_DEFAULT_BUDGET_USD
      ? parseFloat(process.env.STRATEGY_DEFAULT_BUDGET_USD)
      : undefined,
    retroDir: process.env.STRATEGY_RETRO_DIR ?? undefined,
    executionTtlMs: process.env.STRATEGY_EXECUTION_TTL_MS
      ? parseInt(process.env.STRATEGY_EXECUTION_TTL_MS, 10)
      : undefined,
    maxExecutions: process.env.STRATEGY_MAX_EXECUTIONS
      ? parseInt(process.env.STRATEGY_MAX_EXECUTIONS, 10)
      : undefined,
  });
}
