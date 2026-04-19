// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const TriggersConfigSchema = z.object({
  enabled: z.boolean().default(true),
  strategyDir: z.string().default('.method/strategies'),
  defaultDebounceMs: z.number().default(5000),
  maxBatchSize: z.number().default(10),
  maxWatchers: z.number().default(50),
  historySize: z.number().default(200),
  logFires: z.boolean().default(true),
  webhookMaxPayloadBytes: z.number().default(1048576),
  gitPollIntervalMs: z.number().default(5000),
});

export type TriggersConfig = z.infer<typeof TriggersConfigSchema>;

export function loadTriggersConfig(): TriggersConfig {
  return TriggersConfigSchema.parse({
    enabled: process.env.TRIGGERS_ENABLED !== undefined
      ? process.env.TRIGGERS_ENABLED !== 'false'
      : undefined,
    strategyDir: process.env.TRIGGERS_STRATEGY_DIR ?? undefined,
    defaultDebounceMs: process.env.TRIGGERS_DEFAULT_DEBOUNCE_MS
      ? parseInt(process.env.TRIGGERS_DEFAULT_DEBOUNCE_MS, 10)
      : undefined,
    maxBatchSize: process.env.TRIGGERS_MAX_BATCH_SIZE
      ? parseInt(process.env.TRIGGERS_MAX_BATCH_SIZE, 10)
      : undefined,
    maxWatchers: process.env.TRIGGERS_MAX_WATCHERS
      ? parseInt(process.env.TRIGGERS_MAX_WATCHERS, 10)
      : undefined,
    historySize: process.env.TRIGGERS_HISTORY_SIZE
      ? parseInt(process.env.TRIGGERS_HISTORY_SIZE, 10)
      : undefined,
    logFires: process.env.TRIGGERS_LOG_FIRES !== undefined
      ? process.env.TRIGGERS_LOG_FIRES !== 'false'
      : undefined,
    webhookMaxPayloadBytes: process.env.TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES
      ? parseInt(process.env.TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES, 10)
      : undefined,
    gitPollIntervalMs: process.env.TRIGGERS_GIT_POLL_INTERVAL_MS
      ? parseInt(process.env.TRIGGERS_GIT_POLL_INTERVAL_MS, 10)
      : undefined,
  });
}
