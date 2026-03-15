import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionDiagnostics,
  classifyStall,
  type SessionDiagnostics,
} from '../diagnostics.js';
import { matchPermissionPrompt } from '../pattern-matchers.js';
import { createPtyWatcher, parseWatcherConfig, type WatcherConfig } from '../pty-watcher.js';
import { createSessionChannels, readMessages, type SessionChannels } from '../channels.js';

// ── SessionDiagnostics Factory Tests ─────────────────────────────

describe('createSessionDiagnostics (PRD 012)', () => {
  it('creates diagnostics with all fields initialized', () => {
    const diag = createSessionDiagnostics();
    assert.equal(diag.time_to_first_output_ms, null);
    assert.equal(diag.time_to_first_tool_ms, null);
    assert.equal(diag.tool_call_count, 0);
    assert.equal(diag.total_settle_overhead_ms, 0);
    assert.equal(diag.false_positive_settles, 0);
    assert.equal(diag.current_settle_delay_ms, 1000);
    assert.equal(diag.idle_transitions, 0);
    assert.equal(diag.longest_idle_ms, 0);
    assert.equal(diag.permission_prompt_detected, false);
    assert.equal(diag.stall_reason, null);
  });

  it('accepts custom settle delay', () => {
    const diag = createSessionDiagnostics(500);
    assert.equal(diag.current_settle_delay_ms, 500);
  });
});

// ── Stall Classification Tests ───────────────────────────────────

describe('classifyStall (PRD 012)', () => {
  let diag: SessionDiagnostics;

  beforeEach(() => {
    diag = createSessionDiagnostics();
  });

  it('classifies as permission_blocked when no tool calls ever made', () => {
    // time_to_first_tool_ms remains null (no tools detected)
    diag.time_to_first_output_ms = 1500;
    const reason = classifyStall(diag);
    assert.equal(reason, 'permission_blocked');
  });

  it('classifies as task_complexity when tool calls exist but many idle transitions', () => {
    diag.time_to_first_tool_ms = 3000;
    diag.tool_call_count = 15;
    diag.idle_transitions = 4;  // > 3
    const reason = classifyStall(diag);
    assert.equal(reason, 'task_complexity');
  });

  it('classifies as resource_contention when slow start and other agents slow', () => {
    diag.time_to_first_output_ms = 15000;  // > 10000ms
    diag.time_to_first_tool_ms = 20000;
    diag.tool_call_count = 1;
    diag.idle_transitions = 1;
    const reason = classifyStall(diag, true);  // otherSessionsSlow = true
    assert.equal(reason, 'resource_contention');
  });

  it('does not classify as resource_contention when other agents are fast', () => {
    diag.time_to_first_output_ms = 15000;
    diag.time_to_first_tool_ms = 20000;
    diag.tool_call_count = 1;
    diag.idle_transitions = 1;
    const reason = classifyStall(diag, false);
    assert.equal(reason, 'unknown');
  });

  it('classifies as unknown when no conditions match', () => {
    diag.time_to_first_tool_ms = 2000;
    diag.tool_call_count = 5;
    diag.idle_transitions = 2;  // <= 3
    diag.time_to_first_output_ms = 1000;  // <= 10000
    const reason = classifyStall(diag);
    assert.equal(reason, 'unknown');
  });

  it('priority: permission_blocked > task_complexity', () => {
    // No tool calls but many idle transitions — permission_blocked wins
    diag.idle_transitions = 5;
    const reason = classifyStall(diag);
    assert.equal(reason, 'permission_blocked');
  });

  it('priority: task_complexity > resource_contention', () => {
    diag.time_to_first_output_ms = 15000;
    diag.time_to_first_tool_ms = 20000;
    diag.tool_call_count = 10;
    diag.idle_transitions = 5;
    const reason = classifyStall(diag, true);
    assert.equal(reason, 'task_complexity');
  });
});

// ── Permission Prompt Pattern Tests ──────────────────────────────

describe('matchPermissionPrompt (PRD 012)', () => {
  it('detects "Allow X? (y/n)" pattern', () => {
    const matches = matchPermissionPrompt('Allow Read? (y/n)');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, 'permission_prompt');
    assert.equal(matches[0].channelTarget, 'events');
    assert.equal(matches[0].messageType, 'permission_prompt');
  });

  it('detects "Allow X? (Yes/No)" pattern', () => {
    const matches = matchPermissionPrompt('Allow Bash tool to execute? (Yes/No)');
    assert.equal(matches.length, 1);
  });

  it('detects "Allow X? (Y/N)" pattern', () => {
    const matches = matchPermissionPrompt('Allow Edit file? (Y/N)');
    assert.equal(matches.length, 1);
  });

  it('detects permission prompt with tool context', () => {
    const matches = matchPermissionPrompt('Allow Write to /src/index.ts? (y/n)');
    assert.equal(matches.length, 1);
  });

  it('returns empty for text without permission prompt', () => {
    const matches = matchPermissionPrompt('Just some regular text');
    assert.equal(matches.length, 0);
  });

  it('returns empty for "Allow" without the y/n prompt', () => {
    const matches = matchPermissionPrompt('Allow me to explain');
    assert.equal(matches.length, 0);
  });
});

// ── Diagnostics Integration with PtyWatcher ──────────────────────

describe('PtyWatcher diagnostics tracking (PRD 012)', () => {
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
      patterns: new Set(['tool_call', 'git_commit', 'test_result', 'file_operation', 'build_result', 'error', 'idle', 'permission_prompt']),
      rateLimitMs: 0,
      dedupWindowMs: 0,
      autoRetro: false,
      logMatches: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    channels = createSessionChannels();
    subscribers = new Set();
  });

  it('tracks time_to_first_output_ms on first PTY data', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-1', channels, makeSubscribeFn(), defaultConfig(), diag);

    assert.equal(diag.time_to_first_output_ms, null);

    emitData('some initial output\n');

    assert.ok(diag.time_to_first_output_ms !== null);
    assert.ok(diag.time_to_first_output_ms! >= 0);

    watcher.detach();
  });

  it('tracks tool_call_count incrementally', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-2', channels, makeSubscribeFn(), defaultConfig(), diag);

    emitData('Read file at /src/index.ts\n');
    assert.equal(diag.tool_call_count, 1);

    emitData('Edit file at /src/pool.ts\n');
    assert.equal(diag.tool_call_count, 2);

    emitData('Bash command: npm test\n');
    assert.equal(diag.tool_call_count, 3);

    watcher.detach();
  });

  it('tracks time_to_first_tool_ms on first tool call', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-3', channels, makeSubscribeFn(), defaultConfig(), diag);

    assert.equal(diag.time_to_first_tool_ms, null);

    emitData('some non-tool output\n');
    assert.equal(diag.time_to_first_tool_ms, null);

    emitData('Read file at /src/index.ts\n');
    assert.ok(diag.time_to_first_tool_ms !== null);
    assert.ok(diag.time_to_first_tool_ms! >= 0);

    // Second tool call shouldn't change the first tool time
    const firstToolTime = diag.time_to_first_tool_ms;
    emitData('Edit file at /src/pool.ts\n');
    assert.equal(diag.time_to_first_tool_ms, firstToolTime);

    watcher.detach();
  });

  it('tracks idle_transitions count', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-4', channels, makeSubscribeFn(), defaultConfig(), diag);

    assert.equal(diag.idle_transitions, 0);

    // Activity then idle
    emitData('Read file at /src/index.ts\n');
    emitData('❯\n');
    assert.equal(diag.idle_transitions, 1);

    // More activity then idle again
    emitData('Edit file at /src/pool.ts\n');
    emitData('❯\n');
    assert.equal(diag.idle_transitions, 2);

    watcher.detach();
  });

  it('tracks longest_idle_ms', async () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-5', channels, makeSubscribeFn(), defaultConfig(), diag);

    // Activity → idle → wait → activity (computes idle duration)
    emitData('Read file at /src/index.ts\n');
    emitData('❯\n');

    // Small delay to create measurable idle period
    await new Promise(r => setTimeout(r, 50));

    emitData('Edit file at /src/pool.ts\n');

    // longest_idle_ms should be >= 50ms (the delay)
    assert.ok(diag.longest_idle_ms >= 40, `Expected >= 40ms, got ${diag.longest_idle_ms}ms`);

    watcher.detach();
  });

  it('detects permission prompt and sets permission_prompt_detected', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-6', channels, makeSubscribeFn(), defaultConfig(), diag);

    assert.equal(diag.permission_prompt_detected, false);

    emitData('Allow Read? (y/n)\n');
    assert.equal(diag.permission_prompt_detected, true);

    watcher.detach();
  });

  it('emits permission_prompt event to events channel', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-7', channels, makeSubscribeFn(), defaultConfig(), diag);

    emitData('Allow Bash tool to run npm test? (Yes/No)\n');

    const events = readMessages(channels.events, 0);
    const permEvent = events.messages.find(m => m.type === 'permission_prompt');
    assert.ok(permEvent);
    assert.equal(permEvent.sender, 'pty-watcher');

    watcher.detach();
  });

  it('exposes diagnostics on watcher interface', () => {
    const diag = createSessionDiagnostics();
    const watcher = createPtyWatcher('diag-8', channels, makeSubscribeFn(), defaultConfig(), diag);

    assert.equal(watcher.diagnostics, diag);
    assert.equal(watcher.diagnostics!.tool_call_count, 0);

    emitData('Read file\n');
    assert.equal(watcher.diagnostics!.tool_call_count, 1);

    watcher.detach();
  });

  it('returns null diagnostics when not provided', () => {
    const watcher = createPtyWatcher('diag-9', channels, makeSubscribeFn(), defaultConfig());
    assert.equal(watcher.diagnostics, null);
    watcher.detach();
  });
});

// ── parseWatcherConfig includes permission_prompt ────────────────

describe('parseWatcherConfig with permission_prompt (PRD 012)', () => {
  it('includes permission_prompt in default "all" patterns', () => {
    const config = parseWatcherConfig({});
    assert.ok(config.patterns.has('permission_prompt'));
    assert.equal(config.patterns.size, 8);  // 7 original + permission_prompt
  });
});
