// SPDX-License-Identifier: Apache-2.0
// PRD-057 / S2 §3.6: @methodts/runtime/config — cost-governor configuration schema.
// Moved from packages/bridge/src/domains/cost-governor/config.ts.

import { z } from 'zod';
import { randomBytes } from 'node:crypto';

export const CostGovernorConfigSchema = z.object({
  /** Enable cost governor. If false, all features are bypassed. */
  enabled: z.boolean().default(true),

  /** Directory for JSONL observation files and bucket snapshots. */
  dataDir: z.string().default('.method/data'),

  /** HMAC secret for observation integrity. Auto-generated if empty. */
  hmacSecret: z.string().default(''),

  /** Cap on in-memory observations per signature. */
  maxObservationsPerSignature: z.number().int().positive().default(1000),

  /** Rate limit: max msgs per 5h burst window. Max-20x = ~900. */
  burstCapacity: z.number().int().positive().default(900),

  /** Rate limit: weekly cap (0 = unlimited). */
  weeklyCap: z.number().int().nonnegative().default(12600),

  /** Max concurrent in-flight invocations. */
  concurrentCap: z.number().int().positive().default(5),

  /** Default slot acquisition timeout in ms. */
  slotTimeoutMs: z.number().int().positive().default(30_000),
});

export type CostGovernorConfig = z.infer<typeof CostGovernorConfigSchema>;

export function loadCostGovernorConfig(
  overrides: Partial<CostGovernorConfig> = {},
): CostGovernorConfig {
  const parsed = CostGovernorConfigSchema.parse({
    enabled: process.env.COST_GOVERNOR_ENABLED
      ? process.env.COST_GOVERNOR_ENABLED !== 'false'
      : undefined,
    dataDir: process.env.COST_GOVERNOR_DATA_DIR ?? undefined,
    hmacSecret: process.env.COST_GOVERNOR_HMAC_SECRET ?? undefined,
    burstCapacity: process.env.COST_GOVERNOR_BURST_CAPACITY
      ? parseInt(process.env.COST_GOVERNOR_BURST_CAPACITY, 10)
      : undefined,
    weeklyCap: process.env.COST_GOVERNOR_WEEKLY_CAP
      ? parseInt(process.env.COST_GOVERNOR_WEEKLY_CAP, 10)
      : undefined,
    concurrentCap: process.env.COST_GOVERNOR_CONCURRENT_CAP
      ? parseInt(process.env.COST_GOVERNOR_CONCURRENT_CAP, 10)
      : undefined,
    ...overrides,
  });

  // Auto-generate HMAC secret if not provided
  if (!parsed.hmacSecret) {
    parsed.hmacSecret = randomBytes(32).toString('hex');
  }

  return parsed;
}
