import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pactBuilder, agentRequestBuilder } from './builders.js';

describe('pactBuilder', () => {
  it('builds a minimal pact with oneshot mode by default', () => {
    const pact = pactBuilder().build();
    assert.deepEqual(pact.mode, { type: 'oneshot' });
    assert.equal(pact.budget, undefined);
    assert.equal(pact.output, undefined);
    assert.equal(pact.scope, undefined);
  });

  it('builds a pact with budget', () => {
    const pact = pactBuilder()
      .withBudget({ maxTurns: 5, maxCostUsd: 0.50 })
      .build();

    assert.equal(pact.budget?.maxTurns, 5);
    assert.equal(pact.budget?.maxCostUsd, 0.50);
  });

  it('builds a pact with all contracts', () => {
    const schema = {
      parse: (raw: unknown) => ({ success: true as const, data: raw as string }),
      description: 'string output',
    };

    const pact = pactBuilder<string>()
      .withMode({ type: 'resumable' })
      .withStreaming(true)
      .withBudget({ maxTokens: 10000, maxTurns: 10 })
      .withOutput({ schema })
      .withScope({ allowedTools: ['Read', 'Grep'], model: 'claude-sonnet-4-6' })
      .withContext({ strategy: 'compact', compactionThreshold: 0.8 })
      .withReasoning({ thinkTool: true, effort: 'high' })
      .build();

    assert.deepEqual(pact.mode, { type: 'resumable' });
    assert.equal(pact.streaming, true);
    assert.equal(pact.budget?.maxTokens, 10000);
    assert.equal(pact.output?.schema?.description, 'string output');
    assert.deepEqual(pact.scope?.allowedTools, ['Read', 'Grep']);
    assert.equal(pact.context?.strategy, 'compact');
    assert.equal(pact.reasoning?.thinkTool, true);
  });

  it('does not include undefined optional fields', () => {
    const pact = pactBuilder().build();
    const keys = Object.keys(pact);
    assert.deepEqual(keys, ['mode']);
  });
});

describe('agentRequestBuilder', () => {
  it('builds a request with default prompt', () => {
    const request = agentRequestBuilder().build();
    assert.equal(request.prompt, 'test prompt');
    assert.equal(request.workdir, undefined);
  });

  it('builds a request with all fields', () => {
    const request = agentRequestBuilder()
      .withPrompt('do the thing')
      .withWorkdir('/tmp/work')
      .withSystemPrompt('you are helpful')
      .withResumeSessionId('sess-123')
      .withMetadata({ taskId: 42 })
      .build();

    assert.equal(request.prompt, 'do the thing');
    assert.equal(request.workdir, '/tmp/work');
    assert.equal(request.systemPrompt, 'you are helpful');
    assert.equal(request.resumeSessionId, 'sess-123');
    assert.deepEqual(request.metadata, { taskId: 42 });
  });

  it('does not include undefined optional fields', () => {
    const request = agentRequestBuilder().build();
    const keys = Object.keys(request);
    assert.deepEqual(keys, ['prompt']);
  });
});
