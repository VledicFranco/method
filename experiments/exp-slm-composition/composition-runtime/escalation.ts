/**
 * Escalation — retry loop and frontier fallback logic.
 *
 * When a gate fails:
 * 1. Retry the previous stage up to maxRetries times
 * 2. If retries exhausted, apply escalation policy (abort/skip/frontier)
 *
 * For SLM stages, retry gets a different output (temperature > 0).
 * For deterministic stages, retry is pointless — skip straight to escalation.
 */

import type {
  StagePort,
  StageInput,
  GatePort,
  GateInput,
  GateResult,
  FailurePolicy,
  PipelineContext,
} from './types.js';

export interface RetryResult {
  /** Final output data after retries/escalation. */
  data: string;
  /** Final gate result (may be a pass after retry, or the last failure). */
  gateResult: GateResult;
  /** Number of retry attempts made. */
  retryCount: number;
  /** Whether escalation was triggered. */
  escalated: boolean;
  /** Which escalation target was used, if any. */
  escalationTarget?: string;
}

/**
 * Execute a stage, validate with a gate, retry on failure, escalate if needed.
 */
export async function executeWithRetry(
  stage: StagePort,
  gate: GatePort,
  stageInput: StageInput,
  policy: FailurePolicy,
  buildGateInput: (data: string, context: PipelineContext) => GateInput,
): Promise<RetryResult> {
  // For deterministic stages, retry is pointless (same input → same output)
  const maxRetries = stage.type === 'deterministic' ? 0 : policy.maxRetries;

  let lastData = stageInput.data;
  let lastGateResult: GateResult | undefined;
  let retryCount = 0;

  // The initial execution already happened before this function is called.
  // This function handles the retry loop starting from the first failure.

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Re-run the stage to get different output
      const stageOutput = await stage.execute(stageInput);
      lastData = stageOutput.data;
      retryCount++;
    }

    const gateInput = buildGateInput(lastData, stageInput.context);
    lastGateResult = await gate.validate(gateInput);

    if (lastGateResult.pass) {
      return {
        data: lastData,
        gateResult: lastGateResult,
        retryCount,
        escalated: false,
      };
    }
  }

  // Retries exhausted — apply escalation policy
  switch (policy.escalation) {
    case 'abort':
      return {
        data: lastData,
        gateResult: lastGateResult!,
        retryCount,
        escalated: true,
        escalationTarget: 'abort',
      };

    case 'skip':
      // Continue with the failed data — downstream stages may still work
      return {
        data: lastData,
        gateResult: lastGateResult!,
        retryCount,
        escalated: true,
        escalationTarget: 'skip',
      };

    case 'frontier': {
      const frontierOutput = await escalateToFrontier(
        policy.frontierConfig!,
        stageInput.data,
        lastGateResult!.reason ?? 'Unknown gate failure',
      );
      return {
        data: frontierOutput,
        gateResult: lastGateResult!,
        retryCount,
        escalated: true,
        escalationTarget: 'frontier',
      };
    }
  }
}

/**
 * Escalate to a frontier LLM when the SLM fails.
 *
 * Every escalation is a training signal — the frontier output paired with
 * the original input becomes training data for the next SLM fine-tuning run.
 *
 * Currently a stub that throws. Real implementation would call Anthropic API
 * or Ollama with a larger model.
 */
export async function escalateToFrontier(
  config: NonNullable<FailurePolicy['frontierConfig']>,
  _originalInput: string,
  failureReason: string,
): Promise<string> {
  // TODO: Implement real frontier escalation via Ollama or Anthropic API
  throw new Error(
    `Frontier escalation not yet implemented. ` +
    `Provider: ${config.provider}, Model: ${config.model}. ` +
    `Failure: ${failureReason}`,
  );
}
