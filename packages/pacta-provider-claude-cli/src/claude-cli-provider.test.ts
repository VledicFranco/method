/**
 * Tests for Claude CLI Provider.
 *
 * All CLI execution is mocked — no actual `claude` process is spawned.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Pact, AgentRequest, ProviderCapabilities } from '@method/pacta';
import { claudeCliProvider } from './claude-cli-provider.js';
import { buildCliArgs, type CliArgs } from './cli-executor.js';
import { simpleCodeAgent } from './simple-code-agent.js';

// ── Mock Helpers ─────────────────────────────────────────────────

function createMockProcess(
  stdoutData: string,
  stderrData: string,
  exitCode: number,
): { spawnFn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess } {
  const spawnFn = (cmd: string, args: string[], _opts: SpawnOptions): ChildProcess => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const proc = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: { end(): void };
      kill(signal?: string): boolean;
    };
    proc.stdout = stdoutStream;
    proc.stderr = stderrStream;
    proc.stdin = { end() {} };
    proc.kill = () => true;

    // Schedule data emission and close after listeners are attached
    setImmediate(() => {
      stdoutStream.end(stdoutData);
      stderrStream.end(stderrData);
      // Emit close after streams finish
      setImmediate(() => {
        proc.emit('close', exitCode);
      });
    });

    return proc as unknown as ChildProcess;
  };

  return { spawnFn };
}

/**
 * Creates a mock process that can be killed via an AbortSignal.
 * When killed, it emits close with code null (like a SIGTERM kill).
 */
function createAbortableMockProcess(): {
  spawnFn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
} {
  const spawnFn = (_cmd: string, _args: string[], _opts: SpawnOptions): ChildProcess => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const proc = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: { end(): void };
      kill(signal?: string): boolean;
    };
    proc.stdout = stdoutStream;
    proc.stderr = stderrStream;
    proc.stdin = { end() {} };
    proc.kill = (_signal?: string): boolean => {
      // Simulate the process being killed: emit close with null exit code
      setImmediate(() => {
        stdoutStream.end('');
        stderrStream.end('');
        setImmediate(() => {
          proc.emit('close', null);
        });
      });
      return true;
    };

    // Process hangs — never emits close unless killed
    return proc as unknown as ChildProcess;
  };

  return { spawnFn };
}

// ── Test Fixtures ────────────────────────────────────────────────

const basePact: Pact<string> = {
  mode: { type: 'oneshot' },
};

const baseRequest: AgentRequest = {
  prompt: 'Hello, world!',
};

// ── Tests: Provider Capabilities ─────────────────────────────────

describe('claudeCliProvider', () => {
  describe('capabilities', () => {
    it('returns correct capabilities', () => {
      const provider = claudeCliProvider();
      const caps: ProviderCapabilities = provider.capabilities();

      assert.deepStrictEqual(caps.modes, ['oneshot', 'resumable']);
      assert.strictEqual(caps.streaming, false);
      assert.strictEqual(caps.resumable, true);
      assert.strictEqual(caps.budgetEnforcement, 'none');
      assert.strictEqual(caps.outputValidation, 'client');
      assert.strictEqual(caps.toolModel, 'builtin');
    });

    it('has name "claude-cli"', () => {
      const provider = claudeCliProvider();
      assert.strictEqual(provider.name, 'claude-cli');
    });
  });

  // ── Tests: CLI Argument Construction ─────────────────────────

  describe('invoke — CLI arguments', () => {
    it('constructs correct args for oneshot invocation', async () => {
      let capturedArgs: string[] = [];

      const { spawnFn } = createMockProcess('response text', '', 0);
      const originalSpawnFn = spawnFn;
      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgs = args;
        return originalSpawnFn(cmd, args, opts);
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      await provider.invoke(basePact, baseRequest);

      assert.ok(capturedArgs.includes('--print'), 'should include --print flag');
      assert.ok(capturedArgs.includes('Hello, world!'), 'should include prompt');
      assert.ok(!capturedArgs.includes('--resume'), 'should not include --resume');
    });

    it('includes --resume flag for resume calls', async () => {
      let capturedArgs: string[] = [];

      const { spawnFn } = createMockProcess('resumed response', '', 0);
      const originalSpawnFn = spawnFn;
      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgs = args;
        return originalSpawnFn(cmd, args, opts);
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      await provider.resume('session-abc-123', basePact, baseRequest);

      assert.ok(capturedArgs.includes('--resume'), 'should include --resume');
      assert.ok(capturedArgs.includes('session-abc-123'), 'should include session ID');
    });

    it('passes model from pact scope', async () => {
      let capturedArgs: string[] = [];

      const { spawnFn } = createMockProcess('response', '', 0);
      const originalSpawnFn = spawnFn;
      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgs = args;
        return originalSpawnFn(cmd, args, opts);
      };

      const pact: Pact<string> = {
        mode: { type: 'oneshot' },
        scope: { model: 'claude-sonnet-4-20250514' },
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      await provider.invoke(pact, baseRequest);

      assert.ok(capturedArgs.includes('--model'), 'should include --model');
      assert.ok(capturedArgs.includes('claude-sonnet-4-20250514'), 'should include model name');
    });

    it('passes allowedTools from pact scope', async () => {
      let capturedArgs: string[] = [];

      const { spawnFn } = createMockProcess('response', '', 0);
      const originalSpawnFn = spawnFn;
      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgs = args;
        return originalSpawnFn(cmd, args, opts);
      };

      const pact: Pact<string> = {
        mode: { type: 'oneshot' },
        scope: { allowedTools: ['Read', 'Write'] },
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      await provider.invoke(pact, baseRequest);

      assert.ok(capturedArgs.includes('--allowedTools'), 'should include --allowedTools');
      assert.ok(capturedArgs.includes('Read,Write'), 'should include comma-separated tools');
    });
  });

  // ── Tests: Response Parsing ────────────────────────────────────

  describe('invoke — response parsing', () => {
    it('parses stdout into AgentResult (plain text fallback)', async () => {
      const { spawnFn } = createMockProcess('The answer is 42.', '', 0);

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.output, 'The answer is 42.');
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.stopReason, 'complete');
      assert.strictEqual(result.turns, 1);
      assert.ok(result.durationMs >= 0, 'should have non-negative duration');
      assert.ok(result.sessionId, 'should have a session ID');
    });

    it('parses session ID from stderr (plain text fallback)', async () => {
      const { spawnFn } = createMockProcess(
        'response',
        'session_id: abc-123-def',
        0,
      );

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.sessionId, 'abc-123-def');
    });

    it('throws CliExecutionError on non-zero exit code', async () => {
      const { spawnFn } = createMockProcess('', 'Error: something broke', 1);

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      await assert.rejects(
        () => provider.invoke(basePact, baseRequest),
        (err: Error) => {
          assert.strictEqual(err.name, 'CliExecutionError');
          return true;
        },
      );
    });

    it('returns empty token usage when stdout is plain text (no JSON)', async () => {
      const { spawnFn } = createMockProcess('response', '', 0);

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.usage.inputTokens, 0);
      assert.strictEqual(result.usage.outputTokens, 0);
      assert.strictEqual(result.usage.totalTokens, 0);
      assert.strictEqual(result.cost.totalUsd, 0);
    });

    it('parses JSON output and populates usage and cost', async () => {
      const jsonResponse = JSON.stringify({
        result: 'Parsed agent response',
        session_id: 'json-session-xyz',
        num_turns: 3,
        stop_reason: 'end_turn',
        total_cost_usd: 0.0042,
        model_usage: {
          'claude-sonnet-4': {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 10,
          },
        },
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
        },
      });

      const { spawnFn } = createMockProcess(jsonResponse, '', 0);

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.output, 'Parsed agent response');
      assert.strictEqual(result.sessionId, 'json-session-xyz');
      assert.strictEqual(result.turns, 3);
      assert.strictEqual(result.stopReason, 'complete'); // 'end_turn' → 'complete'
      assert.strictEqual(result.cost.totalUsd, 0.0042);

      // Usage
      assert.strictEqual(result.usage.inputTokens, 100);
      assert.strictEqual(result.usage.outputTokens, 50);
      assert.strictEqual(result.usage.cacheWriteTokens, 20);
      assert.strictEqual(result.usage.cacheReadTokens, 10);
      assert.strictEqual(result.usage.totalTokens, 150);

      // Per-model cost
      const modelEntry = result.cost.perModel['claude-sonnet-4'];
      assert.ok(modelEntry, 'should have per-model entry');
      assert.strictEqual(modelEntry.tokens.inputTokens, 100);
      assert.strictEqual(modelEntry.tokens.outputTokens, 50);
      assert.strictEqual(modelEntry.tokens.cacheWriteTokens, 20);
      assert.strictEqual(modelEntry.tokens.cacheReadTokens, 10);
    });

    it('maps stop_reason "max_turns" to "budget_exhausted"', async () => {
      const jsonResponse = JSON.stringify({
        result: 'Hit max turns',
        session_id: 'sess-max',
        num_turns: 10,
        stop_reason: 'max_turns',
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      });

      const { spawnFn } = createMockProcess(jsonResponse, '', 0);
      const provider = claudeCliProvider({ executorOptions: { spawnFn } });

      const result = await provider.invoke(basePact, baseRequest);
      assert.strictEqual(result.stopReason, 'budget_exhausted');
    });
  });

  // ── Tests: Session Tracking ────────────────────────────────────

  describe('session tracking', () => {
    it('first invocation with sessionId uses --session-id (not --resume)', async () => {
      const capturedArgsList: string[][] = [];

      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgsList.push([...args]);
        const { spawnFn } = createMockProcess(
          JSON.stringify({ result: 'ok', session_id: 'sess-1', num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0 }),
          '',
          0,
        );
        return spawnFn(cmd, args, opts);
      };

      const pact: Pact<string> = {
        mode: { type: 'resumable', sessionId: 'sess-1' },
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      await provider.invoke(pact, baseRequest);

      const firstArgs = capturedArgsList[0];
      assert.ok(firstArgs, 'should have captured args');

      const sessionIdIdx = firstArgs.indexOf('--session-id');
      assert.ok(sessionIdIdx !== -1, 'first invocation should use --session-id');
      assert.strictEqual(firstArgs[sessionIdIdx + 1], 'sess-1');
      assert.ok(!firstArgs.includes('--resume'), 'first invocation should NOT use --resume');
    });

    it('subsequent invocation uses --resume after first invocation', async () => {
      const capturedArgsList: string[][] = [];

      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgsList.push([...args]);
        const { spawnFn } = createMockProcess(
          JSON.stringify({ result: 'ok', session_id: 'sess-2', num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0 }),
          '',
          0,
        );
        return spawnFn(cmd, args, opts);
      };

      const pact: Pact<string> = {
        mode: { type: 'resumable', sessionId: 'sess-2' },
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      // First invoke
      await provider.invoke(pact, baseRequest);
      // Second invoke
      await provider.invoke(pact, baseRequest);

      const secondArgs = capturedArgsList[1];
      assert.ok(secondArgs, 'should have second invocation args');

      const resumeIdx = secondArgs.indexOf('--resume');
      assert.ok(resumeIdx !== -1, 'second invocation should use --resume');
      assert.strictEqual(secondArgs[resumeIdx + 1], 'sess-2');
      assert.ok(!secondArgs.includes('--session-id'), 'second invocation should NOT use --session-id');
    });

    it('clearHistory: true resets to fresh --session-id even after prior invocations', async () => {
      const capturedArgsList: string[][] = [];

      const trackingSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
        capturedArgsList.push([...args]);
        const { spawnFn } = createMockProcess(
          JSON.stringify({ result: 'ok', session_id: 'sess-3', num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0 }),
          '',
          0,
        );
        return spawnFn(cmd, args, opts);
      };

      const pact: Pact<string> = {
        mode: { type: 'resumable', sessionId: 'sess-3' },
      };

      const provider = claudeCliProvider({
        executorOptions: { spawnFn: trackingSpawnFn },
      });

      // First invoke — establishes session
      await provider.invoke(pact, baseRequest);

      // Second invoke with clearHistory — should reset
      const clearRequest: AgentRequest = {
        prompt: 'fresh start',
        clearHistory: true,
      };
      await provider.invoke(pact, clearRequest);

      const clearArgs = capturedArgsList[1];
      assert.ok(clearArgs, 'should have args for clearHistory call');

      const sessionIdIdx = clearArgs.indexOf('--session-id');
      assert.ok(sessionIdIdx !== -1, 'clearHistory should use --session-id (fresh start)');
      assert.strictEqual(clearArgs[sessionIdIdx + 1], 'sess-3');
      assert.ok(!clearArgs.includes('--resume'), 'clearHistory should NOT use --resume');

      // Third invoke after clearHistory — should use --resume again (re-established)
      await provider.invoke(pact, baseRequest);

      const thirdArgs = capturedArgsList[2];
      // After clearHistory invoke, the session is tracked again on the clearHistory call itself
      // Next call after that should resume
      const resumeIdx = thirdArgs.indexOf('--resume');
      assert.ok(resumeIdx !== -1, 'third invocation after clearHistory should use --resume');
    });
  });

  // ── Tests: AbortSignal ─────────────────────────────────────────

  describe('abortSignal', () => {
    it('abortSignal abort triggers process kill and rejects with CliAbortError', async () => {
      const { spawnFn } = createAbortableMockProcess();

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const controller = new AbortController();
      const request: AgentRequest = {
        prompt: 'long running task',
        abortSignal: controller.signal,
      };

      // Abort after a short delay
      setImmediate(() => controller.abort());

      await assert.rejects(
        () => provider.invoke(basePact, request),
        (err: Error) => {
          assert.strictEqual(err.name, 'CliAbortError', `expected CliAbortError, got ${err.name}: ${err.message}`);
          return true;
        },
      );
    });

    it('already-aborted signal rejects immediately', async () => {
      const { spawnFn } = createAbortableMockProcess();

      const provider = claudeCliProvider({
        executorOptions: { spawnFn },
      });

      const controller = new AbortController();
      controller.abort(); // pre-abort

      const request: AgentRequest = {
        prompt: 'immediate abort',
        abortSignal: controller.signal,
      };

      await assert.rejects(
        () => provider.invoke(basePact, request),
        (err: Error) => {
          assert.strictEqual(err.name, 'CliAbortError');
          return true;
        },
      );
    });
  });
});

// ── Tests: buildCliArgs ──────────────────────────────────────────

describe('buildCliArgs', () => {
  it('builds basic --print args with default json output format', () => {
    const args: CliArgs = { prompt: 'test prompt', print: true };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--print'), 'should include --print');
    assert.ok(result.includes('--output-format'), 'should include --output-format');
    assert.ok(result.includes('json'), 'should default to json format');
    assert.ok(result.includes('test prompt'), 'should include prompt');
  });

  it('includes --resume with session ID', () => {
    const args: CliArgs = {
      prompt: 'continue',
      print: true,
      resumeSessionId: 'sess-123',
    };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--resume'));
    assert.ok(result.includes('sess-123'));
    assert.ok(result.includes('--print'));
  });

  it('includes --session-id on first invocation', () => {
    const args: CliArgs = {
      prompt: 'start',
      print: true,
      sessionId: 'new-sess',
    };
    const result = buildCliArgs(args);

    const idx = result.indexOf('--session-id');
    assert.ok(idx !== -1, 'should include --session-id');
    assert.strictEqual(result[idx + 1], 'new-sess');
    assert.ok(!result.includes('--resume'), 'should not include --resume');
  });

  it('clearHistory with sessionId uses --session-id and ignores resumeSessionId', () => {
    const args: CliArgs = {
      prompt: 'fresh',
      print: true,
      sessionId: 'my-sess',
      resumeSessionId: 'old-sess',
      clearHistory: true,
    };
    const result = buildCliArgs(args);

    const idx = result.indexOf('--session-id');
    assert.ok(idx !== -1, 'should include --session-id');
    assert.strictEqual(result[idx + 1], 'my-sess');
    assert.ok(!result.includes('--resume'), 'should not include --resume when clearHistory');
    assert.ok(!result.includes('old-sess'), 'should not use old resumeSessionId');
  });

  it('does not include --resume when clearHistory is true', () => {
    const args: CliArgs = {
      prompt: 'reset',
      print: true,
      resumeSessionId: 'stale-session',
      clearHistory: true,
    };
    const result = buildCliArgs(args);

    assert.ok(!result.includes('--resume'), 'clearHistory should suppress --resume');
  });

  it('includes --model when specified', () => {
    const args: CliArgs = {
      prompt: 'test',
      print: true,
      model: 'claude-sonnet-4-20250514',
    };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--model'));
    assert.ok(result.includes('claude-sonnet-4-20250514'));
  });

  it('includes --system-prompt when specified', () => {
    const args: CliArgs = {
      prompt: 'test',
      print: true,
      systemPrompt: 'You are a helpful assistant.',
    };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--system-prompt'));
    assert.ok(result.includes('You are a helpful assistant.'));
  });

  it('includes --max-turns when specified', () => {
    const args: CliArgs = {
      prompt: 'test',
      print: true,
      maxTurns: 5,
    };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--max-turns'));
    assert.ok(result.includes('5'));
  });

  it('includes --allowedTools with comma-separated list', () => {
    const args: CliArgs = {
      prompt: 'test',
      print: true,
      allowedTools: ['Read', 'Grep', 'Edit'],
    };
    const result = buildCliArgs(args);

    assert.ok(result.includes('--allowedTools'));
    assert.ok(result.includes('Read,Grep,Edit'));
  });

  it('prompt is always last argument', () => {
    const args: CliArgs = {
      prompt: 'my prompt',
      print: true,
      model: 'test-model',
      resumeSessionId: 'sess-1',
    };
    const result = buildCliArgs(args);

    assert.strictEqual(result[result.length - 1], 'my prompt');
  });

  it('uses text output format when explicitly set', () => {
    const args: CliArgs = {
      prompt: 'test',
      print: true,
      outputFormat: 'text',
    };
    const result = buildCliArgs(args);

    assert.ok(!result.includes('--output-format'), 'text format should not add --output-format flag');
  });
});

// ── Tests: simpleCodeAgent ───────────────────────────────────────

describe('simpleCodeAgent', () => {
  it('can be created and has invoke method', () => {
    const { spawnFn } = createMockProcess('', '', 0);
    const agent = simpleCodeAgent({
      executorOptions: { spawnFn },
    });

    assert.ok(agent, 'agent should be created');
    assert.strictEqual(typeof agent.invoke, 'function', 'should have invoke method');
  });

  it('has correct pact configuration', () => {
    const { spawnFn } = createMockProcess('', '', 0);
    const agent = simpleCodeAgent({
      executorOptions: { spawnFn },
    });

    assert.strictEqual(agent.pact.mode.type, 'oneshot');
    assert.deepStrictEqual(agent.pact.scope?.allowedTools, [
      'Read', 'Grep', 'Glob', 'Edit', 'Write',
    ]);
  });

  it('uses claude-cli provider', () => {
    const { spawnFn } = createMockProcess('', '', 0);
    const agent = simpleCodeAgent({
      executorOptions: { spawnFn },
    });

    assert.strictEqual(agent.provider.name, 'claude-cli');
  });

  it('can invoke and get result from plain text response', async () => {
    const { spawnFn } = createMockProcess('agent response', '', 0);
    const agent = simpleCodeAgent({
      executorOptions: { spawnFn },
    });

    const result = await agent.invoke({ prompt: 'do something' });

    assert.strictEqual(result.output, 'agent response');
    assert.strictEqual(result.completed, true);
  });
});
