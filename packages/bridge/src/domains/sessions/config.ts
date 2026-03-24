import { z } from 'zod';

export const SessionsConfigSchema = z.object({
  maxSessions: z.number().default(10),
  settleDelayMs: z.number().default(1000),
  deadSessionTtlMs: z.number().default(300000),
  staleCheckIntervalMs: z.number().default(60000),
  batchStaggerMs: z.number().default(3000),
  minSpawnGapMs: z.number().default(2000),
  claudeBin: z.string().default('claude'),
});

export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;

export function loadSessionsConfig(): SessionsConfig {
  return SessionsConfigSchema.parse({
    maxSessions: process.env.MAX_SESSIONS
      ? parseInt(process.env.MAX_SESSIONS, 10)
      : undefined,
    settleDelayMs: process.env.SETTLE_DELAY_MS
      ? parseInt(process.env.SETTLE_DELAY_MS, 10)
      : undefined,
    deadSessionTtlMs: process.env.DEAD_SESSION_TTL_MS
      ? parseInt(process.env.DEAD_SESSION_TTL_MS, 10)
      : undefined,
    staleCheckIntervalMs: process.env.STALE_CHECK_INTERVAL_MS
      ? parseInt(process.env.STALE_CHECK_INTERVAL_MS, 10)
      : undefined,
    batchStaggerMs: process.env.BATCH_STAGGER_MS
      ? parseInt(process.env.BATCH_STAGGER_MS, 10)
      : undefined,
    minSpawnGapMs: process.env.MIN_SPAWN_GAP_MS
      ? parseInt(process.env.MIN_SPAWN_GAP_MS, 10)
      : undefined,
    claudeBin: process.env.CLAUDE_BIN ?? undefined,
  });
}
