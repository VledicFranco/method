import { z } from 'zod';

export const StrategiesConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export type StrategiesConfig = z.infer<typeof StrategiesConfigSchema>;

export function loadStrategiesConfig(): StrategiesConfig {
  return StrategiesConfigSchema.parse({
    enabled: process.env.STRATEGY_ENABLED !== undefined
      ? process.env.STRATEGY_ENABLED !== 'false'
      : undefined,
  });
}
