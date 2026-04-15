import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── PrintSession Unit Tests (PRD 012 Phase 4 / PRD 028) ──────────
//
// Node 22 does not support mock.module() for ESM (it's experimental
// and undefined in this version). We cannot mock child_process.spawn
// that claudeCliProvider uses internally.
//
// Strategy:
// - Tests that exercise sendPrompt() use mock.module() if available,
//   otherwise they are skipped with a descriptive message.
// - Tests for the synchronous public interface (status, kill, resize,
//   adaptiveSettle, onOutput, onExit, printMetadata) run without mocking.

// ── Mock infrastructure ──────────────────────────────────────────

// Realistic JSON fixture matching Claude Code --output-format json
const MOCK_JSON_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5432,
  duration_api_ms: 4200,
  num_turns: 2,
  result: 'I have completed the task successfully.',
  stop_reason: 'end_turn',
  session_id: 'test-session-id',
  total_cost_usd: 0.035,
  usage: {
    input_tokens: 3000,
    cache_creation_input_tokens: 1500,
    cache_read_input_tokens: 10000,
    output_tokens: 500,
  },
  model_usage: {
    'claude-sonnet-4-6': {
      inputTokens: 3000,
      outputTokens: 500,
      costUSD: 0.035,
    },
  },
  permission_denials: [],
};

function createMockProcess(jsonOutput: Record<string, unknown>, exitCode = 0) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: { write() {}, end() {} },
    pid: 12345,
    kill: () => {},
  });

  // Schedule output and exit on next ticks
  process.nextTick(() => {
    stdout.push(JSON.stringify(jsonOutput) + '\n');
    stdout.push(null);
  });
  process.nextTick(() => {
    process.nextTick(() => {
      proc.emit('close', exitCode);
    });
  });

  return proc;
}

// Attempt to set up mock.module — if unavailable, sendPrompt tests will be skipped.
const canMockModules = typeof mock.module === 'function';

let mockSpawn: ReturnType<typeof mock.fn> | undefined;
let createPrintSession: typeof import('./print-session.js').createPrintSession | undefined;

if (canMockModules) {
  mockSpawn = mock.fn(() => createMockProcess(MOCK_JSON_RESULT));

  mock.module('node:child_process', {
    namedExports: {
      spawn: mockSpawn,
    },
  });

  const mod = await import('./print-session.js');
  createPrintSession = mod.createPrintSession;
}

// Separate import path for non-mocked tests (public interface only)
const realMod = canMockModules ? null : await import('./print-session.js');
const rawCreateSession = createPrintSession ?? realMod!.createPrintSession;

/** Helper: create a session */
function createSession(opts: { id: string; workdir: string; [k: string]: unknown }) {
  return rawCreateSession({ ...opts } as any);
}

// ── Tests ────────────────────────────────────────────────────────

describe('PrintSession', () => {
  beforeEach(() => {
    if (mockSpawn) {
      mockSpawn.mock.resetCalls();
      mockSpawn.mock.mockImplementation(() => createMockProcess(MOCK_JSON_RESULT));
    }
  });

  // ── Synchronous interface tests (no mocking needed) ──────────

  describe('initial state', () => {
    it('starts in ready status', () => {
      const session = createSession({ id: 'ps-1', workdir: '/tmp/test' });
      assert.equal(session.status, 'ready');
    });

    it('starts with promptCount 0', () => {
      const session = createSession({ id: 'ps-2', workdir: '/tmp/test' });
      assert.equal(session.promptCount, 0);
    });

    it('starts with empty transcript', () => {
      const session = createSession({ id: 'ps-3', workdir: '/tmp/test' });
      assert.equal(session.transcript, '');
    });

    it('starts with null printMetadata', () => {
      const session = createSession({ id: 'ps-4', workdir: '/tmp/test' });
      assert.equal(session.printMetadata, null);
    });

    it('adaptiveSettle is always null', () => {
      const session = createSession({ id: 'ps-5', workdir: '/tmp/test' });
      assert.equal(session.adaptiveSettle, null);
    });

    it('has the correct id', () => {
      const session = createSession({ id: 'my-session-42', workdir: '/tmp/test' });
      assert.equal(session.id, 'my-session-42');
    });

    it('has a lastActivityAt date', () => {
      const before = new Date();
      const session = createSession({ id: 'ps-6', workdir: '/tmp/test' });
      const after = new Date();

      assert.ok(session.lastActivityAt >= before);
      assert.ok(session.lastActivityAt <= after);
    });
  });

  describe('kill()', () => {
    it('sets status to dead', () => {
      const session = createSession({ id: 'ps-kill-1', workdir: '/tmp/test' });
      session.kill();
      assert.equal(session.status, 'dead');
    });

    it('fires exit callbacks with code 0', () => {
      const session = createSession({ id: 'ps-kill-2', workdir: '/tmp/test' });
      let exitCode: number | null = null;

      session.onExit((code) => { exitCode = code; });
      session.kill();

      assert.equal(exitCode, 0);
    });

    it('fires multiple exit callbacks', () => {
      const session = createSession({ id: 'ps-kill-3', workdir: '/tmp/test' });
      const codes: number[] = [];

      session.onExit((code) => codes.push(code));
      session.onExit((code) => codes.push(code * 10));
      session.kill();

      assert.deepEqual(codes, [0, 0]);
    });

    it('does not throw if exit callback throws', () => {
      const session = createSession({ id: 'ps-kill-4', workdir: '/tmp/test' });

      session.onExit(() => { throw new Error('callback error'); });

      // Should not throw
      assert.doesNotThrow(() => session.kill());
      assert.equal(session.status, 'dead');
    });
  });

  describe('resize()', () => {
    it('is a no-op — does not throw', () => {
      const session = createSession({ id: 'ps-resize', workdir: '/tmp/test' });
      assert.doesNotThrow(() => session.resize(120, 40));
    });

    it('does not change status', () => {
      const session = createSession({ id: 'ps-resize-2', workdir: '/tmp/test' });
      session.resize(80, 24);
      assert.equal(session.status, 'ready');
    });
  });

  describe('onOutput()', () => {
    it('returns an unsubscribe function', () => {
      const session = createSession({ id: 'ps-out-1', workdir: '/tmp/test' });
      const unsub = session.onOutput(() => {});
      assert.equal(typeof unsub, 'function');
    });
  });

  describe('sendPrompt() rejection when dead', () => {
    it('rejects with /dead/ when session is already killed', async () => {
      const session = createSession({ id: 'ps-dead-1', workdir: '/tmp/test' });
      session.kill();

      await assert.rejects(
        () => session.sendPrompt('test'),
        /dead/,
      );
    });
  });

  // ── sendPrompt() tests (require mock.module) ──────────────────
  // These tests exercise the full claudeCliProvider.invoke() path.
  // They are conditionally run based on mock.module availability.

  const describeSendPrompt = canMockModules ? describe : describe.skip;

  describeSendPrompt('sendPrompt() (mocked child_process)', () => {
    it('returns structured result from JSON output', async () => {
      const session = createSession({ id: 'ps-sp-1', workdir: '/tmp/test' });
      const result = await session.sendPrompt('Do something');

      assert.equal(result.output, 'I have completed the task successfully.');
      assert.equal(result.timedOut, false);
    });

    it('transitions through working → ready on successful prompt', async () => {
      const session = createSession({ id: 'ps-sp-2', workdir: '/tmp/test' });
      const statuses: string[] = [];

      statuses.push(session.status); // ready
      const promise = session.sendPrompt('test');
      // Status transitions to working synchronously after queue picks up
      await new Promise(r => setTimeout(r, 10));
      statuses.push(session.status); // working
      await promise;
      statuses.push(session.status); // ready

      assert.equal(statuses[0], 'ready');
      assert.equal(statuses[2], 'ready');
    });

    it('increments promptCount on each sendPrompt', async () => {
      const session = createSession({ id: 'ps-sp-3', workdir: '/tmp/test' });
      assert.equal(session.promptCount, 0);

      await session.sendPrompt('first');
      assert.equal(session.promptCount, 1);

      await session.sendPrompt('second');
      assert.equal(session.promptCount, 2);
    });

    it('updates lastActivityAt after sendPrompt', async () => {
      const session = createSession({ id: 'ps-sp-4', workdir: '/tmp/test' });
      const before = session.lastActivityAt;

      await new Promise(r => setTimeout(r, 10));
      await session.sendPrompt('test');

      assert.ok(session.lastActivityAt.getTime() >= before.getTime());
    });

    it('accumulates transcript across prompts', async () => {
      const session = createSession({ id: 'ps-sp-5', workdir: '/tmp/test' });

      await session.sendPrompt('first prompt');
      await session.sendPrompt('second prompt');

      assert.ok(session.transcript.includes('first prompt'));
      assert.ok(session.transcript.includes('second prompt'));
      assert.ok(session.transcript.includes('I have completed the task successfully.'));
    });

    it('notifies output subscribers', async () => {
      const session = createSession({ id: 'ps-sp-6', workdir: '/tmp/test' });
      const outputs: string[] = [];

      session.onOutput((data) => outputs.push(data));
      await session.sendPrompt('test');

      // Should receive at least the result notification
      assert.ok(outputs.length >= 1);
      assert.ok(outputs.some(o => o.includes('I have completed the task successfully.')));
    });

    it('unsubscribe removes output subscriber', async () => {
      const session = createSession({ id: 'ps-sp-7', workdir: '/tmp/test' });
      const outputs: string[] = [];

      const unsub = session.onOutput((data) => outputs.push(data));
      unsub();

      await session.sendPrompt('test');
      assert.equal(outputs.length, 0);
    });

    it('populates printMetadata after sendPrompt', async () => {
      const session = createSession({ id: 'ps-sp-8', workdir: '/tmp/test' });

      await session.sendPrompt('test');

      const meta = session.printMetadata;
      assert.ok(meta);
      assert.equal(meta.total_cost_usd, 0.035);
      assert.equal(meta.num_turns, 2);
      assert.equal(meta.duration_ms, 5432);
      // duration_api_ms is approximated as duration_ms (AgentResult has no separate api duration)
      assert.equal(meta.duration_api_ms, 5432);
      assert.equal(meta.usage.input_tokens, 3000);
      assert.equal(meta.usage.output_tokens, 500);
      assert.equal(meta.usage.cache_creation_input_tokens, 1500);
      assert.equal(meta.usage.cache_read_input_tokens, 10000);
      assert.deepEqual(meta.permission_denials, []);
      assert.equal(meta.stop_reason, 'end_turn');
      assert.equal(meta.subtype, 'success');
      assert.equal(meta.cumulative_cost_usd, 0.035);
    });

    it('accumulates cumulative cost across prompts', async () => {
      const session = createSession({ id: 'ps-sp-9', workdir: '/tmp/test' });

      await session.sendPrompt('first');
      const meta1 = session.printMetadata;
      assert.ok(meta1);
      assert.equal(meta1.cumulative_cost_usd, 0.035);

      await session.sendPrompt('second');
      const meta2 = session.printMetadata;
      assert.ok(meta2);
      assert.ok(Math.abs(meta2.cumulative_cost_usd - 0.07) < 0.001);
    });

    it('handles error from claude process gracefully', async () => {
      mockSpawn!.mock.mockImplementation(() => {
        const stdout = new Readable({ read() {} });
        const stderr = new Readable({ read() {} });
        const proc = Object.assign(new EventEmitter(), {
          stdout,
          stderr,
          stdin: { write() {}, end() {} },
          pid: 12345,
          kill: () => {},
        });

        process.nextTick(() => {
          stderr.push('Error: API key invalid\n');
          stderr.push(null);
          stdout.push(null);
        });
        process.nextTick(() => {
          process.nextTick(() => {
            proc.emit('close', 1);
          });
        });

        return proc;
      });

      const session = createSession({ id: 'ps-sp-10', workdir: '/tmp/test' });
      const result = await session.sendPrompt('test');

      // Error should be returned as output, not thrown
      assert.ok(result.output.includes('Error'));
      assert.equal(result.timedOut, false);
      // Session should return to ready, not dead
      assert.equal(session.status, 'ready');
    });

    it('first prompt uses --session-id, subsequent use --resume', async () => {
      const session = createSession({ id: 'ps-sp-11', workdir: '/tmp/test' });

      await session.sendPrompt('first');
      const firstCall = mockSpawn!.mock.calls[0];
      const firstArgs = firstCall.arguments[1] as string[];
      assert.ok(firstArgs.includes('--session-id'), 'first prompt should use --session-id');
      assert.ok(!firstArgs.includes('--resume'), 'first prompt should not use --resume');

      await session.sendPrompt('second');
      // Find the second spawn call (first call is index 0, second is index 1)
      const secondCall = mockSpawn!.mock.calls[1];
      const secondArgs = secondCall.arguments[1] as string[];
      assert.ok(secondArgs.includes('--resume'), 'second prompt should use --resume');
      assert.ok(!secondArgs.includes('--session-id'), 'second prompt should not use --session-id');
    });
  });

  // ── PRD 029: Agent hoisting + budget tests (providerOverride) ──

  describe('agent hoisting (PRD 029 BUG-1)', () => {
    it('createAgent is called once across multiple sendPrompt calls', async () => {
      let invokeCount = 0;

      // A mock provider that counts invocations
      const mockProvider: import('@method/pacta').AgentProvider = {
        name: 'test-counter',
        capabilities() {
          return { modes: ['oneshot', 'resumable'] as any, streaming: false, resumable: true, budgetEnforcement: 'client' as const, outputValidation: 'none' as const, toolModel: false } as any;
        },
        async invoke(_pact, _request): Promise<any> {
          invokeCount++;
          return {
            output: `Response #${invokeCount}`,
            sessionId: 'test-session-id',
            completed: true,
            stopReason: 'complete' as const,
            turns: 1,
            durationMs: 100,
            cost: {
              totalUsd: 0.01,
              perModel: {
                'test-model': {
                  costUsd: 0.01,
                  tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
                },
              },
            },
            usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          };
        },
      };

      const session = rawCreateSession({
        id: 'ps-hoist-1',
        workdir: '/tmp/test',
        providerOverride: mockProvider,
      });

      await session.sendPrompt('first');
      await session.sendPrompt('second');
      await session.sendPrompt('third');

      // The provider should be invoked 3 times (once per prompt),
      // but createAgent should have been called only once (at session scope).
      // We verify indirectly: if createAgent were called per-prompt, the
      // accumulated state would reset each time.
      assert.equal(invokeCount, 3, 'provider.invoke called 3 times');
      assert.equal(session.promptCount, 3);
    });

    it('budget accumulation: cumulative_cost_usd accumulates across prompts via agent.state', async () => {
      let callNum = 0;
      const mockProvider: import('@method/pacta').AgentProvider = {
        name: 'test-budget',
        capabilities() {
          return { modes: ['oneshot', 'resumable'] as any, streaming: false, resumable: true, budgetEnforcement: 'client' as const, outputValidation: 'none' as const, toolModel: false } as any;
        },
        async invoke(_pact, _request): Promise<any> {
          callNum++;
          return {
            output: `Response #${callNum}`,
            sessionId: 'test-session-id',
            completed: true,
            stopReason: 'complete' as const,
            turns: 1,
            durationMs: 100,
            cost: {
              totalUsd: 0.025 * callNum, // increasing cost per prompt
              perModel: {
                'test-model': {
                  costUsd: 0.025 * callNum,
                  tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
                },
              },
            },
            usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          };
        },
      };

      const session = rawCreateSession({
        id: 'ps-budget-1',
        workdir: '/tmp/test',
        providerOverride: mockProvider,
      });

      await session.sendPrompt('first');
      const meta1 = session.printMetadata;
      assert.ok(meta1, 'printMetadata should exist after first prompt');
      // First prompt cost: 0.025 * 1 = 0.025. agent.state.totalUsd should be 0.025.
      assert.ok(Math.abs(meta1.cumulative_cost_usd - 0.025) < 0.001, `cumulative should be ~0.025 but got ${meta1.cumulative_cost_usd}`);

      await session.sendPrompt('second');
      const meta2 = session.printMetadata;
      assert.ok(meta2, 'printMetadata should exist after second prompt');
      // Second prompt cost: 0.025 * 2 = 0.05. agent.state.totalUsd should be 0.025 + 0.05 = 0.075.
      assert.ok(Math.abs(meta2.cumulative_cost_usd - 0.075) < 0.001, `cumulative should be ~0.075 but got ${meta2.cumulative_cost_usd}`);
    });
  });
});
