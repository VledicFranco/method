/**
 * CLM Pipeline Execution Engine
 *
 * Executes a PipelineDefinition: iterates over stages and gates, handles
 * retry/escalation on gate failure, collects per-stage metrics.
 *
 * Execution model (from docs/arch/composition-runtime.md):
 *   for each step:
 *     if stage: execute, record metrics, update currentData
 *     if gate: validate → pass: continue | fail: retry → escalate
 */

import type {
  PipelineDefinition,
  PipelineStep,
  PipelineResult,
  PipelineContext,
  GateInput,
} from './types.js';
import { createMetricsCollector } from './metrics.js';
import { executeWithRetry } from './escalation.js';

/**
 * Execute a CLM pipeline from start to finish.
 *
 * @param definition The pipeline definition (stages + gates)
 * @param input The initial input string
 * @param options Optional callbacks
 * @returns PipelineResult with final data, success flag, and metrics
 */
export async function executePipeline(
  definition: PipelineDefinition,
  input: string,
  options?: {
    metadata?: Record<string, unknown>;
  },
): Promise<PipelineResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const collector = createMetricsCollector(definition.id);
  const pipelineStart = performance.now();

  let currentData = input;
  let state = new Map<string, unknown>();

  const context: PipelineContext = {
    runId,
    pipelineId: definition.id,
    originalInput: input,
    metadata: options?.metadata ?? {},
    state,
  };

  // Build a helper to find the preceding stage for any gate step
  const steps = definition.stages;

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Update context with latest state
      const currentContext: PipelineContext = { ...context, state };

      if (step.type === 'stage') {
        const stageStart = performance.now();
        const output = await step.stage.execute({
          data: currentData,
          context: currentContext,
        });
        const stageLatency = performance.now() - stageStart;

        // Merge state updates from stage
        if (output.stateUpdates) {
          state = new Map([...state, ...output.stateUpdates]);
        }

        collector.recordStage({
          stageId: step.stage.id,
          latencyMs: stageLatency,
          confidence: output.confidence,
          retryCount: 0,
          escalated: false,
        });

        currentData = output.data;

      } else if (step.type === 'gate') {
        // Find the preceding stage (walk backward)
        const precedingStage = findPrecedingStage(steps, i);

        const gateInput: GateInput = {
          data: currentData,
          context: currentContext,
        };

        // First attempt
        const firstResult = await step.gate.validate(gateInput);

        if (firstResult.pass) {
          // Gate passed on first try
          collector.recordGate({ gateId: step.gate.id, pass: true });

          if (firstResult.stateUpdates) {
            state = new Map([...state, ...firstResult.stateUpdates]);
          }
          if (firstResult.validatedData !== undefined && typeof firstResult.validatedData === 'string') {
            currentData = firstResult.validatedData;
          }
          continue;
        }

        // Gate failed — enter retry/escalation
        if (!precedingStage) {
          // No preceding stage to retry — treat as abort
          collector.recordGate({
            gateId: step.gate.id,
            pass: false,
            reason: firstResult.reason,
          });

          const totalLatency = performance.now() - pipelineStart;
          return {
            success: false,
            data: currentData,
            metrics: collector.finalize(false, totalLatency),
            error: `Gate ${step.gate.id} failed with no preceding stage to retry: ${firstResult.reason}`,
          };
        }

        const retryResult = await executeWithRetry(
          precedingStage,
          step.gate,
          { data: currentData, context: currentContext },
          step.onFail,
          (data, ctx) => ({ data, context: ctx }),
        );

        collector.recordGate({
          gateId: step.gate.id,
          pass: retryResult.gateResult.pass,
          reason: retryResult.gateResult.pass ? undefined : retryResult.gateResult.reason,
        });

        // Update the preceding stage metrics with retry info
        if (retryResult.retryCount > 0 || retryResult.escalated) {
          collector.recordStage({
            stageId: precedingStage.id,
            latencyMs: 0,
            confidence: 0,
            retryCount: retryResult.retryCount,
            escalated: retryResult.escalated,
            escalationTarget: retryResult.escalationTarget,
          });
        }

        if (retryResult.escalationTarget === 'abort' && !retryResult.gateResult.pass) {
          const totalLatency = performance.now() - pipelineStart;
          return {
            success: false,
            data: retryResult.data,
            metrics: collector.finalize(false, totalLatency),
            error: `Gate ${step.gate.id} failed after ${retryResult.retryCount} retries: ${retryResult.gateResult.reason}`,
          };
        }

        // Merge state updates from successful retry
        if (retryResult.gateResult.stateUpdates) {
          state = new Map([...state, ...retryResult.gateResult.stateUpdates]);
        }

        currentData = retryResult.data;
      }
    }

    const totalLatency = performance.now() - pipelineStart;
    return {
      success: true,
      data: currentData,
      metrics: collector.finalize(true, totalLatency),
    };

  } catch (err) {
    const totalLatency = performance.now() - pipelineStart;
    const error = err as Error;
    return {
      success: false,
      data: currentData,
      metrics: collector.finalize(false, totalLatency),
      error: error.message,
    };
  }
}

/**
 * Find the most recent stage step before index i.
 */
function findPrecedingStage(steps: readonly PipelineStep[], gateIndex: number) {
  for (let j = gateIndex - 1; j >= 0; j--) {
    const step = steps[j];
    if (step.type === 'stage') {
      return step.stage;
    }
  }
  return undefined;
}
