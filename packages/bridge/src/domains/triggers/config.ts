import { z } from 'zod';

export const TriggersConfigSchema = z.object({
  enabled: z.boolean().default(true),
  strategyDir: z.string().default('.method/strategies'),
});

export type TriggersConfig = z.infer<typeof TriggersConfigSchema>;

export function loadTriggersConfig(): TriggersConfig {
  return TriggersConfigSchema.parse({
    enabled: process.env.TRIGGERS_ENABLED !== undefined
      ? process.env.TRIGGERS_ENABLED !== 'false'
      : undefined,
    strategyDir: process.env.TRIGGERS_STRATEGY_DIR ?? undefined,
  });
}
