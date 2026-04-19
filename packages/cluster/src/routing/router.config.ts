// SPDX-License-Identifier: Apache-2.0
// ── Routing Configuration ───────────────────────────────────────
//
// Zod-validated weight configuration for the CapacityWeightedRouter.
// Weights control how much each resource dimension contributes to
// the routing score. Defaults match the canonical scoring function
// from PRD 039 §3.

import { z } from 'zod';

export const RouterConfigSchema = z.object({
  /** Weight for session headroom (available / max). */
  sessionWeight: z.number().min(0).max(1).default(0.4),

  /** Weight for memory headroom (available / total). */
  memoryWeight: z.number().min(0).max(1).default(0.3),

  /** Weight for CPU headroom (1 - load / 100). */
  cpuWeight: z.number().min(0).max(1).default(0.2),

  /** Bonus weight when the node already has the requested project. */
  localityWeight: z.number().min(0).max(1).default(0.1),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;
