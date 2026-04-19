// SPDX-License-Identifier: Apache-2.0
/**
 * Conformance row for `claudeAgentSdkProvider` (C-1 AC-1.4).
 *
 * Registers the provider with `@methodts/pacta-testkit/provider-conformance`
 * and asserts the row passes. Covers:
 *
 *   1. Capabilities — modes, streaming, resumable, budgetEnforcement,
 *      outputValidation, toolModel all match the declared surface.
 *   2. Oneshot mode — `drainSdkStream` against scripted SDK messages
 *      (mock transport pattern from `factory.test.ts`; NO real `claude`
 *      CLI subprocess, NO real SDK `query()`).
 *   3. Output validation — the `AgentResult.output` parses against a
 *      caller-supplied `SchemaDefinition`. Since the SDK provider
 *      reports `outputValidation: 'client'`, the row supplies the
 *      schema itself.
 *
 * C-1 deferred this AC because the testkit did not yet have an
 * AgentProvider-level conformance runner. Unit 4 of the overnight
 * mission adds `runProviderConformanceRow` in pacta-testkit and the
 * row here to consume it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SchemaDefinition, AgentResult } from '@methodts/pacta';
import type { SDKMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import {
  runProviderConformanceRow,
  type ProviderConformanceRow,
} from '@methodts/pacta-testkit/provider-conformance';

import { claudeAgentSdkProvider, drainSdkStream } from './factory.js';
import type { AnthropicSdkTransport } from './transport.js';

// ── Mock transport (no real API key, no real subprocess) ──────────

/**
 * Transport that returns empty env and a no-op teardown. Provider
 * construction succeeds; nothing actually spawns because the row
 * never calls `provider.invoke()` — oneshot mode is exercised via
 * `drainSdkStream` against scripted SDK messages.
 */
const mockTransport: AnthropicSdkTransport = {
  async setup() {
    return {
      env: { ANTHROPIC_API_KEY: 'test-conformance-key' },
      teardown: async () => {},
    };
  },
};

// ── Scripted SDK messages (adapted from factory.test.ts) ──────────

function makeSuccessMessages(opts: {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  durationMs: number;
  sessionId: string;
  model: string;
}): SDKMessage[] {
  const usage = {
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: null,
    inference_geo: null,
    iterations: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
  };

  const init = {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '0.0.0',
    cwd: '/',
    tools: [],
    mcp_servers: [],
    model: opts.model,
    permissionMode: 'default',
    slash_commands: [],
    output_style: '',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000001',
    session_id: opts.sessionId,
  } as unknown as SDKMessage;

  const assistant = {
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000002',
    session_id: opts.sessionId,
    message: {
      content: [{ type: 'text', text: opts.text }],
    },
  } as unknown as SDKMessage;

  const result: SDKResultSuccess = {
    type: 'result',
    subtype: 'success',
    duration_ms: opts.durationMs,
    duration_api_ms: opts.durationMs,
    is_error: false,
    num_turns: opts.turns,
    result: opts.text,
    stop_reason: 'end_turn',
    total_cost_usd: opts.costUsd,
    usage: usage as never,
    modelUsage: {
      [opts.model]: {
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: opts.costUsd,
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    },
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000003',
    session_id: opts.sessionId,
  } as unknown as SDKResultSuccess;

  return [init, assistant, result];
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

// ── Output schema — permissive string check ───────────────────────

/**
 * The SDK provider returns raw assistant text as `AgentResult.output`.
 * For conformance purposes we require the output be a non-empty string;
 * richer parsing belongs to tenant-specific tests.
 */
const nonEmptyStringSchema: SchemaDefinition<string> = {
  parse(raw) {
    if (typeof raw !== 'string') {
      return { success: false, errors: [`expected string, got ${typeof raw}`] };
    }
    if (raw.length === 0) {
      return { success: false, errors: ['expected non-empty string'] };
    }
    return { success: true, data: raw };
  },
  description: 'non-empty string',
};

// ── Row registration ───────────────────────────────────────────────

const claudeAgentSdkRow: ProviderConformanceRow<string> = {
  id: 'pacta-provider-claude-agent-sdk',
  expectedCapabilities: {
    modes: ['oneshot'],
    streaming: true,
    resumable: false,
    budgetEnforcement: 'client',
    outputValidation: 'client',
    toolModel: 'function',
  },
  makeProvider: () => claudeAgentSdkProvider({ transport: mockTransport }),
  runOneshot: async (): Promise<AgentResult<string>> => {
    // Drive the same result-assembly path `invoke()` uses, but feed it
    // scripted SDK messages instead of a real subprocess.
    const messages = makeSuccessMessages({
      text: 'conformance oneshot output',
      inputTokens: 80,
      outputTokens: 20,
      costUsd: 0.0005,
      turns: 1,
      durationMs: 120,
      sessionId: 'sess-conformance',
      model: 'claude-sonnet-4-6',
    });
    const startTime = Date.now() - 200;
    return drainSdkStream<string>(fromArray(messages), startTime);
  },
  outputSchema: nonEmptyStringSchema,
};

// ── Test — run the row and assert every check passes ──────────────

describe('claudeAgentSdkProvider — conformance row (AC-1.4)', () => {
  it('passes capabilities, oneshot mode, and output validation', async () => {
    const report = await runProviderConformanceRow(claudeAgentSdkRow);

    if (!report.passed) {
      const failures = report.checks
        .filter((c) => !c.passed)
        .map((c) => `  - ${c.name}: ${c.error}`)
        .join('\n');
      assert.fail(
        `claudeAgentSdkProvider failed conformance row "${report.rowId}":\n${failures}`,
      );
    }

    assert.equal(report.passed, true);
    assert.equal(report.rowId, 'pacta-provider-claude-agent-sdk');
    assert.deepEqual(
      report.checks.map((c) => c.name),
      ['capabilities', 'oneshot', 'outputValidation'],
    );
    assert.ok(
      report.checks.every((c) => c.passed),
      `all checks must pass: ${report.checks.map((c) => `${c.name}=${c.passed}`).join(', ')}`,
    );
  });
});
