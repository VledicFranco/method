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
    it('parses stdout into AgentResult', async () => {
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

    it('parses session ID from stderr', async () => {
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

    it('returns empty token usage (CLI does not report tokens)', async () => {
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
  });
});

// ── Tests: buildCliArgs ──────────────────────────────────────────

describe('buildCliArgs', () => {
  it('builds basic --print args', () => {
    const args: CliArgs = { prompt: 'test prompt', print: true };
    const result = buildCliArgs(args);

    assert.deepStrictEqual(result, ['--print', 'test prompt']);
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

  it('can invoke and get result', async () => {
    const { spawnFn } = createMockProcess('agent response', '', 0);
    const agent = simpleCodeAgent({
      executorOptions: { spawnFn },
    });

    const result = await agent.invoke({ prompt: 'do something' });

    assert.strictEqual(result.output, 'agent response');
    assert.strictEqual(result.completed, true);
  });
});
