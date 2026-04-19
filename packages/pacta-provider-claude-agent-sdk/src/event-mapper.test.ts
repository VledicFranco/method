// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for `mapSdkMessage` — SDK message → pacta `AgentEvent`
 * translation. The mapper is pure; tests are simple input/output
 * fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKResultSuccess,
  SDKResultError,
} from '@anthropic-ai/claude-agent-sdk';
import { mapSdkMessage, mapUsage, emptyUsage } from './event-mapper.js';

// ── Helpers ──────────────────────────────────────────────────────

// UUID is typed as a template literal in the SDK; we widen to `never`
// at the call site so we can hand back a fixed test string without
// fighting the template-literal type inference.
function uuid(): never {
  return '00000000-0000-0000-0000-000000000000' as never;
}

// ── system init ──────────────────────────────────────────────────

describe('mapSdkMessage — system init', () => {
  it('maps system/init → started event', () => {
    const msg = {
      type: 'system',
      subtype: 'init',
      apiKeySource: 'user',
      claude_code_version: '0.0.0',
      cwd: '/',
      tools: [],
      mcp_servers: [],
      model: 'claude-sonnet-4-6',
      permissionMode: 'default',
      slash_commands: [],
      output_style: '',
      skills: [],
      plugins: [],
      uuid: uuid(),
      session_id: 'sess-123',
    } as unknown as SDKSystemMessage;

    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'started');
    if (events[0]?.type === 'started') {
      assert.equal(events[0].sessionId, 'sess-123');
      assert.ok(events[0].timestamp);
    }
  });

  it('drops system messages with non-init subtypes', () => {
    const msg = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: uuid(),
      session_id: 'sess-x',
    } as unknown as SDKMessage;
    assert.deepEqual(mapSdkMessage(msg), []);
  });
});

// ── assistant text + tool_use ────────────────────────────────────

describe('mapSdkMessage — assistant', () => {
  it('maps text content blocks to text events', () => {
    const msg: SDKAssistantMessage = {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: uuid(),
      session_id: 'sess-1',
      message: {
        content: [
          { type: 'text', text: 'Hello!' } as unknown as never,
          { type: 'text', text: 'World.' } as unknown as never,
        ],
      } as never,
    };
    const events = mapSdkMessage(msg);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => e.type),
      ['text', 'text'],
    );
    if (events[0]?.type === 'text') assert.equal(events[0].content, 'Hello!');
    if (events[1]?.type === 'text') assert.equal(events[1].content, 'World.');
  });

  it('maps tool_use blocks to tool_use events', () => {
    const msg: SDKAssistantMessage = {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: uuid(),
      session_id: 'sess-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-abc',
            name: 'Bash',
            input: { command: 'ls' },
          } as unknown as never,
        ],
      } as never,
    };
    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'tool_use');
    if (events[0]?.type === 'tool_use') {
      assert.equal(events[0].tool, 'Bash');
      assert.equal(events[0].toolUseId, 'tu-abc');
      assert.deepEqual(events[0].input, { command: 'ls' });
    }
  });

  it('skips empty text blocks', () => {
    const msg: SDKAssistantMessage = {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: uuid(),
      session_id: 'sess-1',
      message: {
        content: [{ type: 'text', text: '' } as unknown as never],
      } as never,
    };
    assert.deepEqual(mapSdkMessage(msg), []);
  });

  it('maps thinking blocks to thinking events', () => {
    const msg: SDKAssistantMessage = {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: uuid(),
      session_id: 'sess-1',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me consider...' } as unknown as never,
        ],
      } as never,
    };
    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'thinking');
  });
});

// ── user / tool_result ───────────────────────────────────────────

describe('mapSdkMessage — user tool_result', () => {
  it('maps tool_result blocks to tool_result events', () => {
    const msg: SDKUserMessage = {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-abc',
            content: 'output text',
          } as unknown as never,
        ],
      } as never,
    };
    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'tool_result');
    if (events[0]?.type === 'tool_result') {
      assert.equal(events[0].toolUseId, 'tu-abc');
      assert.equal(events[0].output, 'output text');
    }
  });

  it('drops user messages without tool_result blocks', () => {
    const msg: SDKUserMessage = {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: 'plain prompt echo',
      } as never,
    };
    assert.deepEqual(mapSdkMessage(msg), []);
  });
});

// ── result success / error ───────────────────────────────────────

describe('mapSdkMessage — result', () => {
  it('maps success result to completed event with usage + cost', () => {
    const msg: SDKResultSuccess = {
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      duration_api_ms: 1000,
      is_error: false,
      num_turns: 2,
      result: 'final answer',
      stop_reason: 'end_turn',
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_creation: null,
        inference_geo: null,
        iterations: null,
        server_tool_use: null,
        service_tier: null,
        speed: null,
      } as never,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 10,
          cacheCreationInputTokens: 5,
          webSearchRequests: 0,
          costUSD: 0.0123,
          contextWindow: 200000,
          maxOutputTokens: 8192,
        },
      },
      permission_denials: [],
      uuid: uuid(),
      session_id: 'sess-1',
    } as unknown as SDKResultSuccess;

    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'completed');
    if (events[0]?.type === 'completed') {
      assert.equal(events[0].turns, 2);
      assert.equal(events[0].durationMs, 1234);
      assert.equal(events[0].cost.totalUsd, 0.0123);
      assert.equal(events[0].usage.inputTokens, 100);
      assert.equal(events[0].usage.outputTokens, 50);
      assert.equal(events[0].usage.totalTokens, 100 + 50 + 10 + 5);
      assert.ok('claude-sonnet-4-6' in events[0].cost.perModel);
    }
  });

  it('maps error result to error event with recoverable=false', () => {
    const msg = {
      type: 'result',
      subtype: 'error_max_turns',
      errors: ['turn limit hit'],
      uuid: uuid(),
      session_id: 'sess-1',
    } as unknown as SDKResultError;
    const events = mapSdkMessage(msg);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'error');
    if (events[0]?.type === 'error') {
      assert.equal(events[0].recoverable, false);
      assert.equal(events[0].code, 'error_max_turns');
      assert.equal(events[0].message, 'turn limit hit');
    }
  });
});

// ── Unknown message types ────────────────────────────────────────

describe('mapSdkMessage — unknown types', () => {
  it('returns [] for unknown SDK message types (forward-compat)', () => {
    const msg = { type: 'tool_progress', tool_name: 'X' } as unknown as SDKMessage;
    assert.deepEqual(mapSdkMessage(msg), []);
  });

  it('returns [] for stream_event partial messages (handled by C-3)', () => {
    const msg = { type: 'stream_event', event: {} } as unknown as SDKMessage;
    assert.deepEqual(mapSdkMessage(msg), []);
  });
});

// ── Helpers ──────────────────────────────────────────────────────

describe('mapUsage / emptyUsage', () => {
  it('emptyUsage returns all-zero TokenUsage', () => {
    const u = emptyUsage();
    assert.equal(u.inputTokens, 0);
    assert.equal(u.outputTokens, 0);
    assert.equal(u.cacheReadTokens, 0);
    assert.equal(u.cacheWriteTokens, 0);
    assert.equal(u.totalTokens, 0);
  });

  it('mapUsage sums totalTokens across all four counts', () => {
    const u = mapUsage({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
      cache_creation: null,
      inference_geo: null,
      iterations: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    } as never);
    assert.equal(u.totalTokens, 100);
  });
});
