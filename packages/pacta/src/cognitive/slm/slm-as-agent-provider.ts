// SPDX-License-Identifier: Apache-2.0
/**
 * SLMAsAgentProvider — adapts an SLMInferer into an AgentProvider so it
 * fits into a CascadeProvider tier alongside frontier AgentProviders.
 *
 * SLMs speak a much simpler shape (text in, text out + confidence) than
 * full agent providers (sessions, streaming, tool use). This adapter
 * pulls the prompt off `AgentRequest` and packs the result into a
 * minimal `AgentResult<T>` with the SLM's confidence carried through.
 *
 * The adapter does NOT implement Streamable, Resumable, or Killable —
 * SLMs don't have sessions and the cascade falls back to higher tiers
 * when those capabilities are needed.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md
 */

import type { AgentProvider, ProviderCapabilities } from '../../ports/agent-provider.js';
import type { SLMInferer } from '../../ports/slm-inferer.js';
import type { Pact, AgentRequest, AgentResult } from '../../pact.js';

export interface SLMAsAgentProviderOptions {
  /** Display name for telemetry. Default: 'slm'. */
  readonly name?: string;
  /** Forwarded to SLMInferer.infer. */
  readonly maxLength?: number;
  readonly timeoutMs?: number;
}

export class SLMAsAgentProvider implements AgentProvider {
  readonly name: string;
  private readonly inferer: SLMInferer;
  private readonly maxLength?: number;
  private readonly timeoutMs?: number;

  constructor(inferer: SLMInferer, options?: SLMAsAgentProviderOptions) {
    this.inferer = inferer;
    this.name = options?.name ?? 'slm';
    this.maxLength = options?.maxLength;
    this.timeoutMs = options?.timeoutMs;
  }

  capabilities(): ProviderCapabilities {
    return {
      modes: ['oneshot'],
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
  }

  async invoke<T>(_pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
    const start = Date.now();
    const result = await this.inferer.infer(request.prompt, {
      maxLength: this.maxLength,
      timeoutMs: this.timeoutMs,
    });
    const durationMs = Date.now() - start;
    return {
      output: result.output as unknown as T,
      sessionId: '',
      completed: true,
      stopReason: 'complete',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      cost: { totalUsd: 0, perModel: { [this.name]: { tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }, costUsd: 0 } } },
      durationMs,
      turns: 1,
      confidence: result.confidence,
    };
  }
}
