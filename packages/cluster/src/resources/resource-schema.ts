// SPDX-License-Identifier: Apache-2.0
// ── Resource Schema ─────────────────────────────────────────────
//
// Re-exports the ResourceSnapshot type from types.ts for convenient
// access from the resources domain. Also provides validation and
// construction utilities.

import { z } from 'zod';

// Re-export the canonical type
export type { ResourceSnapshot } from '../types.js';

/** Zod schema for validating ResourceSnapshot objects. */
export const ResourceSnapshotSchema = z.object({
  nodeId: z.string().min(1),
  instanceName: z.string().min(1),
  cpuCount: z.number().int().positive(),
  cpuLoadPercent: z.number().min(0),
  memoryTotalMb: z.number().positive(),
  memoryAvailableMb: z.number().min(0),
  sessionsActive: z.number().int().min(0),
  sessionsMax: z.number().int().positive(),
  projectCount: z.number().int().min(0),
  uptimeMs: z.number().min(0),
  version: z.string().min(1),
});

/** Validate an unknown value as a ResourceSnapshot. Throws on invalid input. */
export function parseResourceSnapshot(value: unknown) {
  return ResourceSnapshotSchema.parse(value);
}

/** Validate an unknown value as a ResourceSnapshot. Returns success/error result. */
export function safeParseResourceSnapshot(value: unknown) {
  return ResourceSnapshotSchema.safeParse(value);
}
