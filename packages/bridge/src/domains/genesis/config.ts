import { z } from 'zod';

export const GenesisConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pollingIntervalMs: z.number().default(5000),
  cursorCleanupIntervalMs: z.number().default(3600000),
});

export type GenesisConfig = z.infer<typeof GenesisConfigSchema>;

export function loadGenesisConfig(): GenesisConfig {
  return GenesisConfigSchema.parse({
    enabled: process.env.GENESIS_ENABLED !== undefined
      ? process.env.GENESIS_ENABLED === 'true'
      : undefined,
    pollingIntervalMs: process.env.GENESIS_POLLING_INTERVAL_MS
      ? parseInt(process.env.GENESIS_POLLING_INTERVAL_MS, 10)
      : undefined,
    cursorCleanupIntervalMs: process.env.CURSOR_CLEANUP_INTERVAL_MS
      ? parseInt(process.env.CURSOR_CLEANUP_INTERVAL_MS, 10)
      : undefined,
  });
}
