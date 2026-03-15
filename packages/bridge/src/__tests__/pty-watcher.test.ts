import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchToolCall,
  matchGitCommit,
  matchTestResult,
  matchFileOperation,
  matchBuildResult,
  matchError,
  PROMPT_CHAR_RE,
} from '../pattern-matchers.js';
import { createPtyWatcher, parseWatcherConfig, stripAnsiCodes, type WatcherConfig } from '../pty-watcher.js';
import { createSessionChannels, readMessages, type SessionChannels } from '../channels.js';
import { generateAutoRetro, type AutoRetroInput } from '../auto-retro.js';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// ── Pattern Matcher Tests ───────────────────────────────────────

describe('Pattern Matchers (PRD 010)', () => {
  // ── Pattern 1: Tool Call Detection ────────────────────────────

  describe('matchToolCall', () => {
    it('detects built-in tools', () => {
      const matches = matchToolCall('Read file at /src/index.ts');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.tool, 'Read');
      assert.equal(matches[0].content.is_mcp, false);
      assert.equal(matches[0].channelTarget, 'progress');
      assert.equal(matches[0].messageType, 'tool_call');
    });

    it('detects multiple built-in tools in one chunk', () => {
      const matches = matchToolCall('Edit file then Bash command then Grep search');
      assert.equal(matches.length, 3);
      const tools = matches.map(m => m.content.tool);
      assert.ok(tools.includes('Edit'));
      assert.ok(tools.includes('Bash'));
      assert.ok(tools.includes('Grep'));
    });

    it('detects MCP tools', () => {
      const matches = matchToolCall('Calling mcp__method__step_advance to advance');
      const mcpMatch = matches.find(m => m.content.is_mcp);
      assert.ok(mcpMatch);
      assert.equal(mcpMatch.content.tool, 'mcp__method__step_advance');
      assert.equal(mcpMatch.content.is_mcp, true);
    });

    it('emits methodology_activity for methodology tools', () => {
      const matches = matchToolCall('Using mcp__method__step_advance');
      const methMatch = matches.find(m => m.messageType === 'methodology_activity');
      assert.ok(methMatch);
      assert.equal(methMatch.content.tool, 'mcp__method__step_advance');
    });

    it('deduplicates same tool in one chunk', () => {
      const matches = matchToolCall('Read one Read two Read three');
      const readMatches = matches.filter(m => m.content.tool === 'Read');
      assert.equal(readMatches.length, 1);
    });

    it('returns empty for text without tools', () => {
      const matches = matchToolCall('Just some regular text without any tool names');
      assert.equal(matches.length, 0);
    });
  });

  // ── Pattern 2: Git Commit Detection ───────────────────────────

  describe('matchGitCommit', () => {
    it('detects git commit output', () => {
      const matches = matchGitCommit('[main abc1234] feat: add new feature');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.branch, 'main');
      assert.equal(matches[0].content.hash, 'abc1234');
      assert.equal(matches[0].content.message, 'feat: add new feature');
      assert.equal(matches[0].channelTarget, 'progress');
      assert.equal(matches[0].messageType, 'git_commit');
    });

    it('detects commit on feature branch', () => {
      const matches = matchGitCommit('[feature/prd-010 def5678] fix: correct regex pattern');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.branch, 'feature/prd-010');
      assert.equal(matches[0].content.hash, 'def5678');
    });

    it('returns empty for non-commit text', () => {
      const matches = matchGitCommit('git status\nOn branch main');
      assert.equal(matches.length, 0);
    });
  });

  // ── Pattern 3: Test Result Detection ──────────────────────────

  describe('matchTestResult', () => {
    it('detects Node.js test runner output', () => {
      const text = '# tests 14\n# pass 12\n# fail 2';
      const matches = matchTestResult(text);
      const progress = matches.find(m => m.messageType === 'test_result');
      assert.ok(progress);
      assert.equal(progress.content.total, 14);
      assert.equal(progress.content.passed, 12);
      assert.equal(progress.content.failed, 2);
      assert.equal(progress.content.runner, 'node');
    });

    it('emits test_failure event when tests fail', () => {
      const text = '# tests 14\n# pass 12\n# fail 2';
      const matches = matchTestResult(text);
      const failure = matches.find(m => m.messageType === 'test_failure');
      assert.ok(failure);
      assert.equal(failure.channelTarget, 'events');
      assert.equal(failure.content.failed, 2);
    });

    it('does not emit test_failure when all pass', () => {
      const text = '# tests 14\n# pass 14\n# fail 0';
      const matches = matchTestResult(text);
      const failure = matches.find(m => m.messageType === 'test_failure');
      assert.equal(failure, undefined);
    });

    it('detects Jest/Vitest output', () => {
      const text = 'Tests: 2 failed, 14 passed, 16 total';
      const matches = matchTestResult(text);
      const progress = matches.find(m => m.messageType === 'test_result');
      assert.ok(progress);
      assert.equal(progress.content.total, 16);
      assert.equal(progress.content.passed, 14);
      assert.equal(progress.content.failed, 2);
      assert.equal(progress.content.runner, 'jest');
    });

    it('detects Jest output with no failures', () => {
      const text = 'Tests: 14 passed, 14 total';
      const matches = matchTestResult(text);
      const progress = matches.find(m => m.messageType === 'test_result');
      assert.ok(progress);
      assert.equal(progress.content.failed, 0);
    });

    it('detects Mocha-style output', () => {
      const text = '14 passing (2s)\n1 failing';
      const matches = matchTestResult(text);
      const progress = matches.find(m => m.messageType === 'test_result');
      assert.ok(progress);
      assert.equal(progress.content.passed, 14);
      assert.equal(progress.content.failed, 1);
      assert.equal(progress.content.runner, 'mocha');
    });
  });

  // ── Pattern 4: File Operation Detection ───────────────────────

  describe('matchFileOperation', () => {
    it('detects Read operations', () => {
      const matches = matchFileOperation('Read: "/src/index.ts"');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.path, '/src/index.ts');
      assert.equal(matches[0].messageType, 'file_activity');
    });

    it('detects Write operations', () => {
      const matches = matchFileOperation('Write: /src/new-file.ts');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.path, '/src/new-file.ts');
      assert.equal(matches[0].content.operation, 'write');
    });

    it('detects Edit operations', () => {
      const matches = matchFileOperation('Edit: /src/pool.ts');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.operation, 'edit');
    });

    it('deduplicates same file', () => {
      const matches = matchFileOperation('Read: /src/a.ts\nRead: /src/a.ts');
      assert.equal(matches.length, 1);
    });
  });

  // ── Pattern 5: Build Result Detection ─────────────────────────

  describe('matchBuildResult', () => {
    it('detects TSC errors', () => {
      const text = 'error TS2345: Argument of type...\nerror TS2322: Type...';
      const matches = matchBuildResult(text);
      const progress = matches.find(m => m.messageType === 'build_result');
      assert.ok(progress);
      assert.equal(progress.content.success, false);
      assert.equal(progress.content.error_count, 2);
    });

    it('emits build_failure event', () => {
      const text = 'error TS2345: Argument of type...';
      const matches = matchBuildResult(text);
      const failure = matches.find(m => m.messageType === 'build_failure');
      assert.ok(failure);
      assert.equal(failure.channelTarget, 'events');
    });

    it('detects build success via exit code', () => {
      const text = 'npm run build\nexit code: 0';
      const matches = matchBuildResult(text);
      const progress = matches.find(m => m.messageType === 'build_result');
      assert.ok(progress);
      assert.equal(progress.content.success, true);
    });
  });

  // ── Pattern 7: Error Detection ────────────────────────────────

  describe('matchError', () => {
    it('detects Node.js errors', () => {
      const text = 'TypeError: Cannot read properties of undefined';
      const matches = matchError(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.error_type, 'TypeError');
      assert.equal(matches[0].channelTarget, 'events');
      assert.equal(matches[0].messageType, 'error_detected');
    });

    it('detects stack traces', () => {
      const text = 'Error: something failed\n    at Object.<anonymous> (/src/index.ts:10:5)';
      const matches = matchError(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.has_stack_trace, true);
    });

    it('detects non-zero exit codes', () => {
      const text = 'exit code: 1';
      const matches = matchError(text);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].content.error_type, 'exit_code');
    });

    it('does not detect exit code 0', () => {
      const text = 'exit code: 0';
      const matches = matchError(text);
      assert.equal(matches.length, 0);
    });

    it('ignores build-related exit codes (handled by build matcher)', () => {
      const text = 'npm run build\nexit code: 1';
      const matches = matchError(text);
      // Should not match because "build" is in the text
      assert.equal(matches.length, 0);
    });
  });

  // ── Pattern 6: Idle Detection (prompt char regex) ─────────────

  describe('PROMPT_CHAR_RE', () => {
    it('matches the prompt character', () => {
      assert.ok(PROMPT_CHAR_RE.test('❯'));
    });

    it('matches prompt in context', () => {
      assert.ok(PROMPT_CHAR_RE.test('some output\n❯ '));
    });

    it('does not match regular text', () => {
      assert.ok(!PROMPT_CHAR_RE.test('just regular text'));
    });
  });
});

// ── PtyWatcher Integration Tests ────────────────────────────────

describe('PtyWatcher (PRD 010)', () => {
  let channels: SessionChannels;
  let subscribers: Set<(data: string) => void>;

  function makeSubscribeFn(): (cb: (data: string) => void) => () => void {
    return (cb) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    };
  }

  function emitData(data: string): void {
    for (const sub of subscribers) {
      sub(data);
    }
  }

  function defaultConfig(overrides?: Partial<WatcherConfig>): WatcherConfig {
    return {
      enabled: true,
      patterns: new Set(['tool_call', 'git_commit', 'test_result', 'file_operation', 'build_result', 'error', 'idle']),
      rateLimitMs: 0,      // disable rate limiting for tests
      dedupWindowMs: 0,    // disable dedup for tests
      autoRetro: false,
      logMatches: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    channels = createSessionChannels();
    subscribers = new Set();
  });

  it('subscribes to PTY output and detects tool calls', () => {
    const watcher = createPtyWatcher('test-1', channels, makeSubscribeFn(), defaultConfig());

    emitData('Read file at /src/index.ts\n');

    const progress = readMessages(channels.progress, 0);
    assert.ok(progress.messages.length > 0);
    const toolCall = progress.messages.find(m => m.type === 'tool_call');
    assert.ok(toolCall);
    assert.equal(toolCall.sender, 'pty-watcher');
    assert.equal(toolCall.content.tool, 'Read');

    watcher.detach();
  });

  it('records observations for all matches', () => {
    const watcher = createPtyWatcher('test-2', channels, makeSubscribeFn(), defaultConfig());

    emitData('[main abc1234] feat: initial commit\n');

    assert.ok(watcher.observations.length > 0);
    const gitObs = watcher.observations.find(o => o.category === 'git_commit');
    assert.ok(gitObs);
    assert.equal(gitObs.detail.hash, 'abc1234');

    watcher.detach();
  });

  it('emits to correct channel (progress vs events)', () => {
    const watcher = createPtyWatcher('test-3', channels, makeSubscribeFn(), defaultConfig());

    emitData('TypeError: Cannot read properties of undefined\n');

    const events = readMessages(channels.events, 0);
    const errorEvent = events.messages.find(m => m.type === 'error_detected');
    assert.ok(errorEvent);
    assert.equal(errorEvent.sender, 'pty-watcher');

    watcher.detach();
  });

  it('detects idle transition', () => {
    const watcher = createPtyWatcher('test-4', channels, makeSubscribeFn(), defaultConfig());

    // Simulate activity then idle
    emitData('Read file at /src/index.ts\n');
    emitData('❯\n');

    const progress = readMessages(channels.progress, 0);
    const idle = progress.messages.find(m => m.type === 'idle');
    assert.ok(idle);
    assert.equal(idle.sender, 'pty-watcher');

    watcher.detach();
  });

  it('does not emit idle without prior activity', () => {
    const watcher = createPtyWatcher('test-5', channels, makeSubscribeFn(), defaultConfig());

    emitData('❯\n');

    const progress = readMessages(channels.progress, 0);
    const idle = progress.messages.find(m => m.type === 'idle');
    assert.equal(idle, undefined);

    watcher.detach();
  });

  it('respects rate limiting', () => {
    const watcher = createPtyWatcher('test-6', channels, makeSubscribeFn(), defaultConfig({
      rateLimitMs: 60_000,  // 60s — effectively blocks all but first
    }));

    emitData('Read file at /src/a.ts\n');
    emitData('Read file at /src/b.ts\n');
    emitData('Read file at /src/c.ts\n');

    const progress = readMessages(channels.progress, 0);
    // Only first tool_call should get through the rate limiter
    const toolCalls = progress.messages.filter(m => m.type === 'tool_call');
    assert.equal(toolCalls.length, 1);

    // But all observations should be recorded
    const toolObs = watcher.observations.filter(o => o.category === 'tool_call');
    assert.ok(toolObs.length >= 3);

    watcher.detach();
  });

  it('disabled watcher produces no output', () => {
    const watcher = createPtyWatcher('test-7', channels, makeSubscribeFn(), defaultConfig({
      enabled: false,
    }));

    emitData('Read file at /src/index.ts\n');

    const progress = readMessages(channels.progress, 0);
    assert.equal(progress.messages.length, 0);
    assert.equal(watcher.observations.length, 0);

    watcher.detach();
  });

  it('respects pattern filter', () => {
    const watcher = createPtyWatcher('test-8', channels, makeSubscribeFn(), defaultConfig({
      patterns: new Set(['git_commit']),  // only git commits
    }));

    emitData('Read file at /src/index.ts\n');
    emitData('[main abc1234] feat: commit\n');

    const progress = readMessages(channels.progress, 0);
    const toolCalls = progress.messages.filter(m => m.type === 'tool_call');
    const gitCommits = progress.messages.filter(m => m.type === 'git_commit');
    assert.equal(toolCalls.length, 0);
    assert.equal(gitCommits.length, 1);

    watcher.detach();
  });

  it('strips ANSI codes before matching', () => {
    const watcher = createPtyWatcher('test-9', channels, makeSubscribeFn(), defaultConfig());

    // Simulate ANSI-wrapped tool name
    emitData('\x1b[1mRead\x1b[0m file at /src/index.ts\n');

    const progress = readMessages(channels.progress, 0);
    const toolCall = progress.messages.find(m => m.type === 'tool_call');
    assert.ok(toolCall);

    watcher.detach();
  });

  it('handles cross-chunk patterns via line buffer', () => {
    const watcher = createPtyWatcher('test-10', channels, makeSubscribeFn(), defaultConfig());

    // Git commit output split across chunks
    emitData('[main abc1234');
    emitData('] feat: split commit message\n');

    const progress = readMessages(channels.progress, 0);
    const gitCommit = progress.messages.find(m => m.type === 'git_commit');
    assert.ok(gitCommit);
    assert.equal(gitCommit.content.hash, 'abc1234');

    watcher.detach();
  });
});

// ── WatcherConfig Tests ─────────────────────────────────────────

describe('parseWatcherConfig', () => {
  it('uses defaults when no env vars set', () => {
    const config = parseWatcherConfig({});
    assert.equal(config.enabled, true);
    assert.equal(config.rateLimitMs, 5000);
    assert.equal(config.dedupWindowMs, 10000);
    assert.equal(config.autoRetro, true);
    assert.equal(config.logMatches, false);
    assert.equal(config.patterns.size, 7);
  });

  it('respects PTY_WATCHER_ENABLED=false', () => {
    const config = parseWatcherConfig({ PTY_WATCHER_ENABLED: 'false' });
    assert.equal(config.enabled, false);
  });

  it('parses comma-separated patterns', () => {
    const config = parseWatcherConfig({ PTY_WATCHER_PATTERNS: 'git_commit,test_result' });
    assert.equal(config.patterns.size, 2);
    assert.ok(config.patterns.has('git_commit'));
    assert.ok(config.patterns.has('test_result'));
  });

  it('per-session metadata overrides env vars', () => {
    const config = parseWatcherConfig(
      { PTY_WATCHER_ENABLED: 'true' },
      { pty_watcher: { enabled: false, patterns: ['git_commit'] } },
    );
    assert.equal(config.enabled, false);
    assert.equal(config.patterns.size, 1);
  });
});

// ── OBS-19: Agent Tool Call + Waiting State Detection ───────────

describe('OBS-19: Agent tool call detection', () => {
  it('matchToolCall detects Agent tool', () => {
    const matches = matchToolCall('Using Agent to spawn sub-agent');
    const agentMatch = matches.find(m => m.content.tool === 'Agent');
    assert.ok(agentMatch);
    assert.equal(agentMatch.content.is_mcp, false);
    assert.equal(agentMatch.channelTarget, 'progress');
  });

  it('watcher records Agent tool_call observation', () => {
    const channels = createSessionChannels();
    const subscribers = new Set<(data: string) => void>();
    const subscribe = (cb: (data: string) => void) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    };
    const config: WatcherConfig = {
      enabled: true,
      patterns: new Set(['tool_call', 'idle']),
      rateLimitMs: 0,
      dedupWindowMs: 0,
      autoRetro: false,
      logMatches: false,
    };

    const watcher = createPtyWatcher('obs19-1', channels, subscribe, config);

    for (const sub of subscribers) sub('Agent tool launched\n');

    const agentObs = watcher.observations.find(
      o => o.category === 'tool_call' && o.detail.tool === 'Agent',
    );
    assert.ok(agentObs, 'Agent tool_call observation should be recorded');

    watcher.detach();
  });

  it('stripAnsiCodes removes ANSI sequences', () => {
    assert.equal(stripAnsiCodes('\x1b[1mAgent\x1b[0m'), 'Agent');
    assert.equal(stripAnsiCodes('plain text'), 'plain text');
  });
});

// ── Auto-Retro Generator Tests ──────────────────────────────────

describe('Auto-Retro Generator (PRD 010)', () => {
  const tmpDir = join(os.tmpdir(), `pty-watcher-test-${Date.now()}`);
  const retrosDir = join(tmpDir, '.method', 'retros');

  beforeEach(() => {
    // Create temp retros directory
    mkdirSync(retrosDir, { recursive: true });
  });

  it('generates retro YAML file', () => {
    const input: AutoRetroInput = {
      sessionId: 'test-session-123',
      nickname: 'impl-1',
      observations: [
        { timestamp: '2026-03-15T14:00:00Z', category: 'tool_call', detail: { tool: 'Read', is_mcp: false } },
        { timestamp: '2026-03-15T14:01:00Z', category: 'tool_call', detail: { tool: 'Edit', is_mcp: false } },
        { timestamp: '2026-03-15T14:02:00Z', category: 'git_commit', detail: { branch: 'main', hash: 'abc1234', message: 'feat: test' } },
      ],
      spawnedAt: new Date('2026-03-15T14:00:00Z'),
      terminatedAt: new Date('2026-03-15T14:30:00Z'),
      terminationReason: 'killed',
      projectRoot: tmpDir,
    };

    const result = generateAutoRetro(input);
    assert.equal(result.written, true);
    assert.ok(result.path);
    assert.ok(existsSync(result.path!));

    const content = readFileSync(result.path!, 'utf-8');
    assert.ok(content.includes('session_id: "test-session-123"'));
    assert.ok(content.includes('nickname: "impl-1"'));
    assert.ok(content.includes('generated_by: pty-watcher'));
    assert.ok(content.includes('termination_reason: "killed"'));
    assert.ok(content.includes('tool_calls: 2'));
    assert.ok(content.includes('hash: abc1234'));
  });

  it('skips when retros directory does not exist', () => {
    const result = generateAutoRetro({
      sessionId: 'test-no-dir',
      nickname: 'test',
      observations: [],
      spawnedAt: new Date(),
      terminatedAt: new Date(),
      terminationReason: 'exited',
      projectRoot: '/nonexistent/path',
    });

    assert.equal(result.written, false);
    assert.equal(result.path, null);
    assert.ok(result.reason?.includes('not found'));
  });

  it('increments sequence number for same date', () => {
    const base: AutoRetroInput = {
      sessionId: 'test-seq',
      nickname: 'seq-test',
      observations: [],
      spawnedAt: new Date(),
      terminatedAt: new Date(),
      terminationReason: 'exited',
      projectRoot: tmpDir,
    };

    const r1 = generateAutoRetro(base);
    const r2 = generateAutoRetro({ ...base, sessionId: 'test-seq-2' });

    assert.equal(r1.written, true);
    assert.equal(r2.written, true);
    assert.ok(r1.path !== r2.path);
  });

  // Cleanup
  it('cleanup temp directory', () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });
});
