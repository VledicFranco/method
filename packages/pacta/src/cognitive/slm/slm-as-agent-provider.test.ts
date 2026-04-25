// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for SLMAsAgentProvider — PRD 057.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SLMAsAgentProvider } from './slm-as-agent-provider.js';
import type { SLMInferer } from '../../ports/slm-inferer.js';
import type { SLMInferenceResult, SLMInferOptions } from './types.js';
import type { Pact, AgentRequest } from '../../pact.js';

class StubInferer implements SLMInferer {
  public lastPrompt: string | undefined;
  public lastOptions: SLMInferOptions | undefined;
  constructor(private readonly result: SLMInferenceResult) {}
  async infer(prompt: string, options?: SLMInferOptions): Promise<SLMInferenceResult> {
    this.lastPrompt = prompt;
    this.lastOptions = options;
    return this.result;
  }
}

const pact = {} as Pact<unknown>;
const request: AgentRequest = { prompt: 'echo' };

describe('SLMAsAgentProvider', () => {
  it('forwards request.prompt to SLMInferer.infer', async () => {
    const inf = new StubInferer({
      output: 'echo-back',
      confidence: 0.9,
      inferenceMs: 10,
      escalated: false,
    });
    const provider = new SLMAsAgentProvider(inf);
    await provider.invoke(pact, request);
    assert.equal(inf.lastPrompt, 'echo');
  });

  it('forwards maxLength and timeoutMs from options', async () => {
    const inf = new StubInferer({
      output: '',
      confidence: 0,
      inferenceMs: 0,
      escalated: false,
    });
    const provider = new SLMAsAgentProvider(inf, { maxLength: 128, timeoutMs: 5000 });
    await provider.invoke(pact, request);
    assert.equal(inf.lastOptions?.maxLength, 128);
    assert.equal(inf.lastOptions?.timeoutMs, 5000);
  });

  it('packs SLM result into AgentResult.confidence', async () => {
    const inf = new StubInferer({
      output: 'response',
      confidence: 0.73,
      inferenceMs: 15,
      escalated: false,
    });
    const provider = new SLMAsAgentProvider(inf, { name: 'qwen' });
    const result = await provider.invoke(pact, request);
    assert.equal(result.output, 'response');
    assert.equal(result.confidence, 0.73);
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, 'complete');
    assert.equal(result.turns, 1);
    // perModel cost report keyed on adapter name
    assert.notEqual(result.cost.perModel['qwen'], undefined);
  });

  it('default name is "slm"', () => {
    const inf = new StubInferer({ output: '', confidence: 0, inferenceMs: 0, escalated: false });
    const provider = new SLMAsAgentProvider(inf);
    assert.equal(provider.name, 'slm');
  });

  it('capabilities reports oneshot mode + no streaming/resumable/tools', () => {
    const inf = new StubInferer({ output: '', confidence: 0, inferenceMs: 0, escalated: false });
    const provider = new SLMAsAgentProvider(inf);
    const caps = provider.capabilities();
    assert.deepEqual(caps.modes, ['oneshot']);
    assert.equal(caps.streaming, false);
    assert.equal(caps.resumable, false);
    assert.equal(caps.toolModel, 'none');
  });
});
