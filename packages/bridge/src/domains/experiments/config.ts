// SPDX-License-Identifier: Apache-2.0
/**
 * Experiments domain — Zod validation schemas (PRD 041 Phase 2).
 *
 * Input schemas for the three primary entry points:
 * - CreateExperimentSchema  — experiment_create
 * - CreateRunSchema         — experiment_run
 * - ReadTracesSchema        — lab_read_traces
 */

import { z } from 'zod';

// ── Condition schema ────────────────────────────────────────────

const ConditionSchema = z.object({
  name: z.string().min(1, 'Condition name must not be empty'),
  preset: z.string().optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  provider: z
    .object({
      type: z.string(),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
    })
    .optional(),
  workspace: z
    .object({
      capacity: z.number().int().positive().optional(),
    })
    .optional(),
  cycle: z
    .object({
      maxCycles: z.number().int().positive().optional(),
      maxToolsPerCycle: z.number().int().positive().optional(),
    })
    .optional(),
});

// ── CreateExperimentSchema ──────────────────────────────────────

/**
 * Input validation schema for experiment_create.
 *
 * Requires name, hypothesis, at least one condition, and at least one task.
 */
export const CreateExperimentSchema = z.object({
  /** Human-readable experiment name. */
  name: z.string().min(1, 'Experiment name must not be empty'),
  /** The research hypothesis being tested. */
  hypothesis: z.string().min(1, 'Hypothesis must not be empty'),
  /** One or more named conditions (cognitive agent configurations). */
  conditions: z
    .array(ConditionSchema)
    .min(1, 'At least one condition is required'),
  /** One or more task prompts to run. */
  tasks: z
    .array(z.string().min(1))
    .min(1, 'At least one task is required'),
});

export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;

// ── CreateRunSchema ─────────────────────────────────────────────

/**
 * Input validation schema for experiment_run.
 *
 * Requires an experimentId (must exist — enforced in core.ts, AC-07),
 * a conditionName (must match one of the experiment's conditions), and
 * the task to execute.
 */
export const CreateRunSchema = z.object({
  /** ID of the parent experiment. */
  experimentId: z.string().min(1, 'experimentId must not be empty'),
  /** Name of the condition to use for this run. */
  conditionName: z.string().min(1, 'conditionName must not be empty'),
  /** Task prompt to execute. */
  task: z.string().min(1, 'task must not be empty'),
});

export type CreateRunInput = z.infer<typeof CreateRunSchema>;

// ── ReadTracesSchema ────────────────────────────────────────────

/**
 * Input validation schema for lab_read_traces.
 *
 * runId is required. All filter fields are optional.
 */
export const ReadTracesSchema = z.object({
  /** Run ID to read traces for. */
  runId: z.string().min(1, 'runId must not be empty'),
  /** Filter to a specific cycle number. */
  cycleNumber: z.number().int().nonnegative().optional(),
  /** Filter to a specific module ID. */
  moduleId: z.string().optional(),
  /** Filter to a specific execution phase. */
  phase: z.string().optional(),
});

export type ReadTracesInput = z.infer<typeof ReadTracesSchema>;

// ── ExperimentsConfig ───────────────────────────────────────────

export const ExperimentsConfigSchema = z.object({
  /** Base directory for experiment data. Relative to process.cwd(). */
  dataDir: z.string().default('data/experiments'),
});

export type ExperimentsConfig = z.infer<typeof ExperimentsConfigSchema>;

export function loadExperimentsConfig(): ExperimentsConfig {
  return ExperimentsConfigSchema.parse({
    dataDir: process.env.EXPERIMENTS_DATA_DIR ?? undefined,
  });
}
