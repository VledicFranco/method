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
  /** The data the gate should validate on the FIRST attempt (before retries re-run the stage). */
  initialGateData: string,
): Promise<RetryResult> {
  // For deterministic stages, retry is pointless (same input → same output)
  const maxRetries = stage.type === 'deterministic' ? 0 : policy.maxRetries;

  // Start with the data that already failed validation in the pipeline.
  // Retries re-execute the stage with stageInput to produce new data.
  let lastData = initialGateData;
  let lastGateResult: GateResult | undefined;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Re-run the stage with its ORIGINAL input to get different output
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
 * Supports two providers:
 * - 'ollama': Calls Ollama's OpenAI-compatible endpoint (e.g., qwen3-coder:30b on chobits)
 * - Others: throws (not yet implemented)
 */
export async function escalateToFrontier(
  config: NonNullable<FailurePolicy['frontierConfig']>,
  originalInput: string,
  failureReason: string,
): Promise<string> {
  if (config.provider === 'ollama') {
    return escalateViaOllama(config, originalInput, failureReason);
  }

  throw new Error(
    `Frontier escalation not implemented for provider: ${config.provider}. ` +
    `Failure: ${failureReason}`,
  );
}

/**
 * Call Ollama's OpenAI-compatible endpoint with the original input + error context.
 * The prompt instructs the frontier model to produce the output the SLM couldn't.
 */
async function escalateViaOllama(
  config: NonNullable<FailurePolicy['frontierConfig']>,
  originalInput: string,
  failureReason: string,
): Promise<string> {
  // config.model format: "host:port/model" or just "model" (defaults to localhost:11434)
  const parts = config.model.split('/');
  const modelName = parts.length > 1 ? parts.slice(1).join('/') : config.model;
  const baseUrl = parts.length > 1
    ? `http://${parts[0]}`
    : 'http://localhost:11434';
  const endpoint = `${baseUrl}/v1/chat/completions`;

  const systemPrompt = config.prompt || `You are a helpful assistant. The previous attempt to process this input failed with: ${failureReason}. Please produce the correct output.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: originalInput },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Ollama HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const output = data.choices?.[0]?.message?.content ?? '';
    if (!output) {
      throw new Error('Ollama returned empty response');
    }

    return output;
  } finally {
    clearTimeout(timer);
  }
}
