// SPDX-License-Identifier: Apache-2.0
/**
 * Integration test — runs against a live Ollama instance.
 *
 * Requires OLLAMA_HOST env var or defaults to http://chobits:11434
 * Skip with: SKIP_INTEGRATION=1
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaProvider } from './ollama-provider.js';
import type { Pact } from '@methodts/pacta';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://chobits:11434';
const SKIP = process.env.SKIP_INTEGRATION === '1';

describe('ollamaProvider integration (live)', { skip: SKIP }, () => {
  const provider = ollamaProvider({ baseUrl: OLLAMA_HOST });

  before(async () => {
    await provider.init();
    const caps = provider.capabilities();
    console.log(`  Connected to ${OLLAMA_HOST}`);
    console.log(`  Available models: ${caps.models?.join(', ') ?? 'unknown'}`);
  });

  it('init() discovers models from live instance', () => {
    const caps = provider.capabilities();
    assert.ok(caps.models, 'should have models after init');
    assert.ok(caps.models.length > 0, 'should have at least one model');
  });

  it('invoke() returns valid response for simple prompt', async () => {
    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    const result = await provider.invoke(pact, {
      prompt: 'Return exactly this JSON and nothing else: {"hello":"world"}',
      systemPrompt: 'You are a helpful assistant. Return only the requested output, no explanation.',
    });

    assert.equal(result.completed, true);
    assert.equal(result.stopReason, 'complete');
    assert.ok(result.output.length > 0, 'should have non-empty output');
    assert.ok(result.usage.inputTokens > 0, 'should report input tokens');
    assert.ok(result.usage.outputTokens > 0, 'should report output tokens');
    assert.equal(result.cost.totalUsd, 0, 'local inference is free');
    assert.equal(result.turns, 1);
    assert.ok(result.durationMs > 0, 'should report duration');
    console.log(`  Latency: ${result.durationMs}ms, tokens: ${result.usage.totalTokens}`);
  });

  it('invoke() handles Monitor-style cognitive module prompt', async () => {
    const pact: Pact<string> = {
      mode: { type: 'oneshot' },
      budget: { maxOutputTokens: 200 },
    };

    const result = await provider.invoke(pact, {
      prompt: [
        'Workspace signals:',
        '  reasoning_confidence=0.42',
        '  action_outcome=unexpected_error',
        '  tool_result=file_not_found',
        '  consecutive_failures=3',
        '  task_progress=0.15',
      ].join('\n'),
      systemPrompt: [
        'You are a cognitive monitor module. Analyze workspace signals and return a JSON object with:',
        '- anomaly_detected: boolean',
        '- anomaly_type: string or null',
        '- confidence: number 0-1',
        '- severity: "low" | "medium" | "high" | "critical"',
        '- recommendation: "continue" | "replan" | "escalate"',
        'Return ONLY valid JSON, no explanation.',
      ].join('\n'),
    });

    assert.equal(result.completed, true);
    console.log(`  Monitor output: ${result.output}`);
    console.log(`  Latency: ${result.durationMs}ms, tokens: ${result.usage.totalTokens}`);

    // Parse the output to validate structure
    const parsed = JSON.parse(result.output.replace(/```json\n?|\n?```/g, '').trim());
    assert.equal(typeof parsed.anomaly_detected, 'boolean');
    assert.ok(['low', 'medium', 'high', 'critical'].includes(parsed.severity));
    assert.ok(['continue', 'replan', 'escalate'].includes(parsed.recommendation));
    assert.ok(typeof parsed.confidence === 'number');
    assert.ok(parsed.confidence >= 0 && parsed.confidence <= 1);
  });

  it('invoke() handles Observer-style environment processing', async () => {
    const pact: Pact<string> = {
      mode: { type: 'oneshot' },
      budget: { maxOutputTokens: 200 },
    };

    const result = await provider.invoke(pact, {
      prompt: [
        'Tool result (type=shell, tool=npm_test):',
        '  exit_code: 1',
        '  stdout: "12 passing, 3 failing"',
        '  stderr: "TypeError: Cannot read property \'length\' of undefined at src/utils.ts:42"',
      ].join('\n'),
      systemPrompt: [
        'You are a cognitive observer module. Process the tool result and return a JSON object with:',
        '- summary: string (one sentence)',
        '- novelty: number 0-1 (how unexpected is this result)',
        '- salient_facts: string[] (key observations for the workspace)',
        'Return ONLY valid JSON, no explanation.',
      ].join('\n'),
    });

    assert.equal(result.completed, true);
    console.log(`  Observer output: ${result.output}`);
    console.log(`  Latency: ${result.durationMs}ms`);

    const parsed = JSON.parse(result.output.replace(/```json\n?|\n?```/g, '').trim());
    assert.equal(typeof parsed.summary, 'string');
    assert.ok(typeof parsed.novelty === 'number');
    assert.ok(Array.isArray(parsed.salient_facts));
  });

  it('invoke() respects pact.scope.model override', async () => {
    const caps = provider.capabilities();
    const model = caps.models?.[0];
    if (!model) {
      console.log('  Skipping — no models available');
      return;
    }

    const pact: Pact<string> = {
      mode: { type: 'oneshot' },
      scope: { model },
    };

    const result = await provider.invoke(pact, { prompt: 'Say "ok"' });
    assert.equal(result.completed, true);
    console.log(`  Model ${model}: ${result.durationMs}ms`);
  });
});
