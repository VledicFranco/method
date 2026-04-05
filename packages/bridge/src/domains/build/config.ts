/**
 * Build domain configuration — Zod schema.
 *
 * @see PRD 047 — Build Orchestrator §Per-Domain Architecture
 */

import { z } from 'zod';

export const BuildConfigSchema = z.object({
  /** Default budget for orchestrator agent tokens. */
  maxOrchestratorTokens: z.number().default(300_000),
  /** Default budget for orchestrator cost (USD). Does NOT include inner strategy costs. */
  maxOrchestratorCostUsd: z.number().default(5.0),
  /** Max duration for the entire build (ms). Default: 2 hours. */
  maxDurationMs: z.number().default(7_200_000),
  /** Max implement→review cycles before escalation. */
  reviewLoopLimit: z.number().default(2),
  /** Max validate→implement cycles before reporting partial success. */
  validateLoopLimit: z.number().default(1),
  /** Per-phase timeout (ms). Default: 30 minutes. */
  phaseTimeoutMs: z.number().default(1_800_000),
  /** Default autonomy level for new builds. */
  defaultAutonomyLevel: z.enum(["discuss-all", "auto-routine", "full-auto"]).default("discuss-all"),
  /** Confidence threshold for auto-routine gate approval. */
  autoRoutineConfidenceThreshold: z.number().default(0.85),
  /** Checkpoint directory (relative to project root). */
  checkpointDir: z.string().default(".method/sessions"),
  /** Minimum refinement confidence to surface in analytics. */
  refinementConfidenceThreshold: z.number().default(0.7),
  /** Minimum refinement frequency (across builds) to surface. */
  refinementFrequencyThreshold: z.number().default(2),
});

export type BuildConfig = z.infer<typeof BuildConfigSchema>;
