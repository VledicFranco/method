// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for `streamSdkInvocation` (PRD AC-3.1, AC-3.2, AC-3.3).
 *
 * The SDK is faked end-to-end via dependency injection — we never
 * spawn the real `claude` CLI subprocess from this test file. The
 * fake `query()` returns a scripted `AsyncGenerator<SDKMessage>` that
 * exercises the full top-level → tool → sub-agent → completion path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, AgentRequest, Pact } from '@methodts/pacta';

import {
  streamSdkInvocation,
  type SdkMessageMapper,
  type SdkQueryFn,
  type SdkQueryHandle,
  type StreamSdkOptions,
} from './stream.js';

// ── Test scaffolding ──────────────────────────────────────────────

interface FakeSdkMessage {
  type: 'system_init' | 'assistant_text' | 'tool_use' | 'tool_result' | 'subagent' | 'completion';
  payload?: unknown;
}

interface FakeQueryHandle extends SdkQueryHandle<FakeSdkMessage> {
  closed: boolean;
  aborted: boolean;
}

function makeFakeQuery(
  messages: readonly FakeSdkMessage[],
  options?: { abortBetween?: number; throwAt?: number; throwError?: Error },
): { fn: SdkQueryFn<FakeSdkMessage>; lastHandle: () => FakeQueryHandle | undefined } {
  let lastHandle: FakeQueryHandle | undefined;

  const fn: SdkQueryFn<FakeSdkMessage> = (params) => {
    const handle: FakeQueryHandle = {
      closed: false,
      aborted: false,
      close() {
        this.closed = true;
      },
      [Symbol.asyncIterator](): AsyncIterator<FakeSdkMessage> {
        let i = 0;
        const ctrl = params.options?.abortController;
        // Listen for SDK-side abort so we can mark `aborted`.
        if (ctrl) {
          const onAbort = (): void => {
            handle.aborted = true;
          };
          if (ctrl.signal.aborted) onAbort();
          else ctrl.signal.addEventListener('abort', onAbort, { once: true });
        }

        return {
          async next(): Promise<IteratorResult<FakeSdkMessage>> {
            // Honor cooperative abort.
            if (ctrl?.signal.aborted) {
              return { value: undefined, done: true };
            }
            if (options?.throwAt !== undefined && i === options.throwAt) {
              throw options.throwError ?? new Error('synthetic SDK failure');
            }
            if (options?.abortBetween !== undefined && i === options.abortBetween) {
              // Caller abort fires here; let the iterator notice on next tick.
              await Promise.resolve();
            }
            if (i >= messages.length) {
              return { value: undefined, done: true };
            }
            const value = messages[i++]!;
            return { value, done: false };
          },
          async return(): Promise<IteratorResult<FakeSdkMessage>> {
            return { value: undefined, done: true };
          },
        };
      },
    };
    lastHandle = handle;
    return handle;
  };

  return { fn, lastHandle: () => lastHandle };
}

// Trivial mapper — one SDK message → one AgentEvent — keeps tests
// independent of C-1's real `event-mapper.ts`.
const mapper: SdkMessageMapper<FakeSdkMessage> = (msg) => {
  switch (msg.type) {
    case 'system_init':
      return [{ type: 'started', sessionId: 'fake-session', timestamp: '2026-04-19T00:00:00Z' }];
    case 'assistant_text':
      return [{ type: 'text', content: String(msg.payload ?? '') }];
    case 'tool_use':
      return [{
        type: 'tool_use',
        tool: String(msg.payload ?? 'unknown'),
        input: {},
        toolUseId: 'use-1',
      }];
    case 'tool_result':
      return [{
        type: 'tool_result',
        tool: String(msg.payload ?? 'unknown'),
        output: 'ok',
        toolUseId: 'use-1',
        durationMs: 0,
      }];
    case 'subagent':
      // PRD AC-3.2 — surface sub-agent activity as opaque tool_use.
      return [{
        type: 'tool_use',
        tool: 'sub-agent',
        input: { name: String(msg.payload ?? 'unknown') },
        toolUseId: 'sub-1',
      }];
    case 'completion':
      return [{
        type: 'completed',
        result: '',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
        cost: { totalUsd: 0, perModel: {} },
        durationMs: 1,
        turns: 1,
      }];
  }
};

const PACT: Pact = { mode: { type: 'oneshot' } };
const REQUEST: AgentRequest = { prompt: 'do the thing' };
const SDK_OPTIONS: StreamSdkOptions = {};

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

// ── AC-3.1 — topological order ────────────────────────────────────

describe('streamSdkInvocation — topological event order (AC-3.1)', () => {
  it('yields started → text → tool_use → tool_result → completed in order', async () => {
    const { fn } = makeFakeQuery([
      { type: 'system_init' },
      { type: 'assistant_text', payload: 'thinking…' },
      { type: 'tool_use', payload: 'Read' },
      { type: 'tool_result', payload: 'Read' },
      { type: 'assistant_text', payload: 'done.' },
      { type: 'completion' },
    ]);

    const events = await collect(streamSdkInvocation(PACT, REQUEST, SDK_OPTIONS, mapper, fn));

    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      'started',
      'text',
      'tool_use',
      'tool_result',
      'text',
      'completed',
    ]);
  });

  it('passes the prompt and options through to the SDK query function', async () => {
    let capturedPrompt: string | undefined;
    let capturedOptions: StreamSdkOptions | undefined;

    const fn: SdkQueryFn<FakeSdkMessage> = (params) => {
      capturedPrompt = params.prompt;
      capturedOptions = params.options;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield { type: 'completion' } as FakeSdkMessage;
        },
      };
    };

    await collect(streamSdkInvocation(PACT, { prompt: 'hello' }, { foo: 1 }, mapper, fn));

    assert.equal(capturedPrompt, 'hello');
    assert.equal(capturedOptions?.['foo'], 1);
    assert.ok(capturedOptions?.abortController, 'fresh AbortController must be attached');
  });
});

// ── AC-3.2 — sub-agent events as opaque tool_use ──────────────────

describe('streamSdkInvocation — sub-agent surfacing (AC-3.2)', () => {
  it('surfaces sub-agent SDK events as opaque tool_use without crashing', async () => {
    const { fn } = makeFakeQuery([
      { type: 'system_init' },
      { type: 'subagent', payload: 'code-reviewer' },
      { type: 'completion' },
    ]);

    const events = await collect(streamSdkInvocation(PACT, REQUEST, SDK_OPTIONS, mapper, fn));

    const subAgentEvent = events.find((e): e is Extract<AgentEvent, { type: 'tool_use' }> =>
      e.type === 'tool_use' && e.tool === 'sub-agent',
    );
    assert.ok(subAgentEvent, 'sub-agent should appear as opaque tool_use');
    assert.deepEqual(subAgentEvent.input, { name: 'code-reviewer' });
  });
});

// ── AC-3.3 — abort cleanly tears down the SDK ─────────────────────

describe('streamSdkInvocation — cancellation (AC-3.3)', () => {
  it('aborting via request.abortSignal stops iteration and closes the SDK handle', async () => {
    const ctrl = new AbortController();
    const { fn, lastHandle } = makeFakeQuery([
      { type: 'system_init' },
      { type: 'assistant_text', payload: 'one' },
      { type: 'assistant_text', payload: 'two' },
      { type: 'assistant_text', payload: 'three' },
      { type: 'completion' },
    ]);

    const collected: AgentEvent[] = [];
    const stream = streamSdkInvocation(
      PACT,
      { prompt: 'long task', abortSignal: ctrl.signal },
      SDK_OPTIONS,
      mapper,
      fn,
    );

    for await (const ev of stream) {
      collected.push(ev);
      if (collected.length === 2) {
        // Started + first text → abort now.
        ctrl.abort();
      }
    }

    assert.ok(collected.length < 5, 'iteration must stop before natural completion');
    const handle = lastHandle();
    assert.ok(handle, 'fake handle should have been created');
    assert.ok(handle.closed, 'Query.close() must be invoked on teardown');
    assert.ok(handle.aborted, 'SDK abortController must have received the abort');
  });

  it('aborting via pact.scope.abortController also tears down the SDK', async () => {
    const ctrl = new AbortController();
    const pact: Pact = {
      mode: { type: 'oneshot' },
      scope: { abortController: ctrl } as unknown as Pact['scope'],
    };
    const { fn, lastHandle } = makeFakeQuery([
      { type: 'system_init' },
      { type: 'assistant_text', payload: 'one' },
      { type: 'completion' },
    ]);

    const stream = streamSdkInvocation(pact, REQUEST, SDK_OPTIONS, mapper, fn);
    let count = 0;
    for await (const _ev of stream) {
      count++;
      if (count === 1) ctrl.abort();
    }

    const handle = lastHandle();
    assert.ok(handle?.closed, 'Query.close() must be invoked on scope abort');
    assert.ok(handle?.aborted, 'scope abort must propagate to SDK controller');
  });

  it('honors an already-aborted signal at start of iteration', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { fn, lastHandle } = makeFakeQuery([
      { type: 'system_init' },
      { type: 'completion' },
    ]);

    const events = await collect(streamSdkInvocation(
      PACT,
      { prompt: 'noop', abortSignal: ctrl.signal },
      SDK_OPTIONS,
      mapper,
      fn,
    ));

    // Pre-aborted signal: the SDK iterator sees aborted state and ends early.
    assert.equal(events.length, 0, 'no events when signal pre-aborted');
    assert.ok(lastHandle()?.closed, 'handle still closes cleanly');
  });
});

// ── SDK error path ────────────────────────────────────────────────

describe('streamSdkInvocation — SDK errors', () => {
  it('emits a final error AgentEvent and re-throws when the SDK throws', async () => {
    const boom = new Error('mock SDK explosion');
    const { fn, lastHandle } = makeFakeQuery(
      [{ type: 'system_init' }],
      { throwAt: 1, throwError: boom },
    );

    const events: AgentEvent[] = [];
    let caught: unknown;
    try {
      for await (const ev of streamSdkInvocation(PACT, REQUEST, SDK_OPTIONS, mapper, fn)) {
        events.push(ev);
      }
    } catch (err) {
      caught = err;
    }

    assert.equal(caught, boom, 'original error must propagate to caller');
    const last = events[events.length - 1];
    assert.equal(last?.type, 'error', 'final event must be type=error');
    assert.equal(
      (last as Extract<AgentEvent, { type: 'error' }>).message,
      'mock SDK explosion',
    );
    assert.ok(lastHandle()?.closed, 'handle must close on error');
  });
});
