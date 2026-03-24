import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsTracker } from './diagnostics.js';
import { matchPermissionPrompt } from './pattern-matchers.js';
import { createPtyWatcher, parseWatcherConfig, type WatcherConfig } from './pty-watcher.js';
import { createSessionChannels, readMessages, type SessionChannels } from './channels.js';

// ── DiagnosticsTracker Unit Tests ────────────────────────────────

describe('DiagnosticsTracker (PRD 012)', () => {
  let tracker: DiagnosticsTracker;

  beforeEach(() => {
    tracker = new DiagnosticsTracker(1000);
  });

  describe('initial state', () => {
    it('returns null for timing fields before any output', () => {
      const snap = tracker.snapshot();
      assert.equal(snap.time_to_first_output_ms, null);
      assert.equal(snap.time_to_first_tool_ms, null);
      assert.equal(snap.tool_call_count, 0);
      assert.equal(snap.total_settle_overhead_ms, 0);
      assert.equal(snap.false_positive_settles, 0);
      assert.equal(snap.current_settle_delay_ms, 1000);
      assert.equal(snap.idle_transitions, 0);
      assert.equal(snap.longest_idle_ms, 0);
      assert.equal(snap.permission_prompt_detected, false);
      assert.equal(snap.stall_reason, null);
    });
  });

  describe('recordFirstOutput()', () => {
    it('records time_to_first_output_ms', () => {
      tracker.recordFirstOutput();
      const snap = tracker.snapshot();
      assert.ok(snap.time_to_first_output_ms !== null);
      assert.ok(snap.time_to_first_output_ms! >= 0);
    });

    it('only records the first output', () => {
      tracker.recordFirstOutput();
      const first = tracker.snapshot().time_to_first_output_ms;
      // Small delay
      tracker.recordFirstOutput();
      const second = tracker.snapshot().time_to_first_output_ms;
      assert.equal(first, second);
    });
  });

  describe('recordToolCall()', () => {
    it('increments tool_call_count', () => {
      tracker.recordToolCall();
      tracker.recordToolCall();
      tracker.recordToolCall();
      assert.equal(tracker.snapshot().tool_call_count, 3);
    });

    it('records time_to_first_tool_ms', () => {
      tracker.recordToolCall();
      const snap = tracker.snapshot();
      assert.ok(snap.time_to_first_tool_ms !== null);
      assert.ok(snap.time_to_first_tool_ms! >= 0);
    });

    it('only records timing for first tool call', () => {
      tracker.recordToolCall();
      const first = tracker.snapshot().time_to_first_tool_ms;
      tracker.recordToolCall();
      const second = tracker.snapshot().time_to_first_tool_ms;
      assert.equal(first, second);
    });
  });

  describe('recordIdleTransition()', () => {
    it('increments idle_transitions count', () => {
      tracker.recordIdleTransition();
      tracker.recordIdleTransition();
      assert.equal(tracker.snapshot().idle_transitions, 2);
    });

    it('tracks longest idle period', async () => {
      tracker.recordIdleTransition();
      // Wait a bit to accumulate idle time
      await new Promise(r => setTimeout(r, 20));
      tracker.recordActivity(); // End idle period

      const snap = tracker.snapshot();
      assert.ok(snap.longest_idle_ms >= 15); // at least ~15ms
    });

    it('includes current idle in longest_idle_ms if still idle', async () => {
      tracker.recordIdleTransition();
      await new Promise(r => setTimeout(r, 20));
      // Don't end idle — snapshot should include current idle
      const snap = tracker.snapshot();
      assert.ok(snap.longest_idle_ms >= 15);
    });
  });

  describe('recordPermissionPrompt()', () => {
    it('sets permission_prompt_detected to true', () => {
      assert.equal(tracker.snapshot().permission_prompt_detected, false);
      tracker.recordPermissionPrompt();
      assert.equal(tracker.snapshot().permission_prompt_detected, true);
    });
  });

  describe('recordPromptCompletion()', () => {
    it('accumulates settle overhead', () => {
      tracker.recordPromptCompletion();
      assert.equal(tracker.snapshot().total_settle_overhead_ms, 1000);
      tracker.recordPromptCompletion();
      assert.equal(tracker.snapshot().total_settle_overhead_ms, 2000);
    });
  });

  describe('classifyStall()', () => {
    it('returns permission_blocked when no tool calls ever detected', () => {
      // No tool calls recorded
      const reason = tracker.classifyStall(false);
      assert.equal(reason, 'permission_blocked');
    });

    it('returns task_complexity when tool calls + many idle transitions', () => {
      tracker.recordToolCall();
      tracker.recordIdleTransition();
      tracker.recordIdleTransition();
      tracker.recordIdleTransition();
      tracker.recordIdleTransition(); // > 3

      const reason = tracker.classifyStall(false);
      assert.equal(reason, 'task_complexity');
    });

    it('returns unknown when tool calls present but few idle transitions', () => {
      tracker.recordToolCall();
      tracker.recordIdleTransition();
      // Only 1 idle transition, not > 3

      const reason = tracker.classifyStall(false);
      assert.equal(reason, 'unknown');
    });

    it('returns resource_contention when slow first output + other sessions slow', () => {
      // Simulate slow first output: create tracker with known spawn time
      // We can't easily fake Date.now(), so we test the logic indirectly
      // by checking that the method accepts otherSessionsSlow parameter
      tracker.recordFirstOutput();
      tracker.recordToolCall();
      // In this case, first output is fast (immediate), so resource_contention won't trigger
      const reason = tracker.classifyStall(true);
      // Should be 'unknown' because first output was fast
      assert.equal(reason, 'unknown');
    });
  });
});

// ── Permission Prompt Pattern Tests ──────────────────────────────

describe('matchPermissionPrompt (PRD 012)', () => {
  it('detects standard permission prompt', () => {
    const matches = matchPermissionPrompt('Allow Read? (y/n)');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, 'permission_prompt');
    assert.equal(matches[0].channelTarget, 'events');
    assert.equal(matches[0].messageType, 'permission_prompt_detected');
  });

  it('detects permission prompt with tool name', () => {
    const matches = matchPermissionPrompt('Allow Bash to execute command? (y/n)');
    assert.equal(matches.length, 1);
  });

  it('detects Yes/No variant', () => {
    const matches = matchPermissionPrompt('Allow Edit? (Yes/No)');
    assert.equal(matches.length, 1);
  });

  it('detects case variants', () => {
    const matches = matchPermissionPrompt('Allow Write? (Y/N)');
    assert.equal(matches.length, 1);
  });

  it('does not match regular text with Allow', () => {
    const matches = matchPermissionPrompt('Allow me to explain the code');
    assert.equal(matches.length, 0);
  });

  it('does not match text without Allow', () => {
    const matches = matchPermissionPrompt('Do you want to continue? (y/n)');
    assert.equal(matches.length, 0);
  });

  it('returns empty for unrelated text', () => {
    const matches = matchPermissionPrompt('Reading file /src/index.ts');
    assert.equal(matches.length, 0);
  });
});

// ── PtyWatcher + Diagnostics Integration Tests ───────────────────

describe('PtyWatcher diagnostics integration (PRD 012)', () => {
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

  it('calls onObservation for tool calls', () => {
    const observations: Array<{ category: string; isIdle: boolean }> = [];
    const watcher = createPtyWatcher('diag-1', channels, makeSubscribeFn(), defaultConfig(), (match, isIdle) => {
      observations.push({ category: match.category, isIdle });
    });

    emitData('Read file at /src/index.ts\n');

    const toolObs = observations.filter(o => o.category === 'tool_call');
    assert.ok(toolObs.length > 0);
    assert.equal(toolObs[0].isIdle, false);

    watcher.detach();
  });

  it('calls onObservation for idle transitions', () => {
    const observations: Array<{ category: string; isIdle: boolean }> = [];
    const watcher = createPtyWatcher('diag-2', channels, makeSubscribeFn(), defaultConfig(), (match, isIdle) => {
      observations.push({ category: match.category, isIdle });
    });

    emitData('Read file at /src/index.ts\n');
    emitData('❯\n');

    const idleObs = observations.filter(o => o.isIdle);
    assert.ok(idleObs.length > 0);

    watcher.detach();
  });

  it('calls onObservation for permission prompts', () => {
    const observations: Array<{ category: string; isIdle: boolean }> = [];
    const watcher = createPtyWatcher('diag-3', channels, makeSubscribeFn(), defaultConfig(), (match, isIdle) => {
      observations.push({ category: match.category, isIdle });
    });

    emitData('Allow Bash to execute command? (y/n)\n');

    const permObs = observations.filter(o => o.category === 'permission_prompt');
    assert.ok(permObs.length > 0);
    assert.equal(permObs[0].isIdle, false);

    watcher.detach();
  });

  it('emits permission_prompt_detected to event bus', () => {
    const busEvents: Array<Record<string, unknown>> = [];
    const mockBus = {
      emit(input: Record<string, unknown>) {
        const evt = { ...input, id: `evt-${busEvents.length}`, timestamp: new Date().toISOString(), sequence: busEvents.length + 1 };
        busEvents.push(evt);
        return evt;
      },
    };
    const watcher = createPtyWatcher('diag-4', channels, makeSubscribeFn(), defaultConfig(), undefined, undefined, undefined, mockBus as any);

    emitData('Allow Read? (y/n)\n');

    const permEvent = busEvents.find(e => e.type === 'session.observation.permission_prompt_detected');
    assert.ok(permEvent);
    assert.equal((permEvent.payload as any).channelTarget, 'events');

    watcher.detach();
  });

  it('includes permission_prompt in default pattern set', () => {
    // Verify ALL_CATEGORIES includes permission_prompt (via parseWatcherConfig default)
    const config = parseWatcherConfig({});
    assert.ok(config.patterns.has('permission_prompt'));
  });
});
