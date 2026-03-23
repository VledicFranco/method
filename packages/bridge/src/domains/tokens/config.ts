import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TokensConfigSchema = z.object({
  sessionsDir: z.string().default(join(homedir(), '.claude', 'projects')),
  oauthToken: z.string().nullable().default(null),
  pollIntervalMs: z.number().default(600000),
});

export type TokensConfig = z.infer<typeof TokensConfigSchema>;

export function loadTokensConfig(): TokensConfig {
  return TokensConfigSchema.parse({
    sessionsDir: process.env.CLAUDE_SESSIONS_DIR ?? undefined,
    oauthToken: process.env.CLAUDE_OAUTH_TOKEN ?? null,
    pollIntervalMs: process.env.USAGE_POLL_INTERVAL_MS
      ? parseInt(process.env.USAGE_POLL_INTERVAL_MS, 10)
      : undefined,
  });
}
