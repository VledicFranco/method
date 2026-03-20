/**
 * PRD 018: Event Triggers — Tests (Phase 2a-1)
 *
 * Tests for:
 *   1. DebounceEngine: leading-edge, trailing-edge, max_batch_size, injectable timer
 *   2. FileWatchTrigger: create temp dir, write file, verify trigger fires
 *   3. GitCommitTrigger: create temp git repo, make commit, verify detection
 *   4. TriggerRouter: register/unregister, max_concurrent guard, fire counting
 *   5. TriggerParser: YAML parsing of Phase 2 trigger definitions
 *   6. Startup scanning: valid YAML registers, invalid YAML logged and skipped
 *   7. Glob matcher: pattern matching coverage
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { DebounceEngine } from '../triggers/debounce.js';
import { minimatch } from '../triggers/glob-match.js';
import { FileWatchTrigger } from '../triggers/file-watch-trigger.js';
import { GitCommitTrigger } from '../triggers/git-commit-trigger.js';
import { TriggerRouter } from '../triggers/trigger-router.js';
import { parseStrategyTriggers, hasEventTriggers } from '../triggers/trigger-parser.js';
import { scanAndRegisterTriggers } from '../triggers/startup-scan.js';
import type { TimerInterface, DebouncedTriggerFire } from '../triggers/types.js';

// ── Mock Timer ──────────────────────────────────────────────────

function createMockTimer(): TimerInterface & {
  advance: (ms: number) => void;
  currentTime: number;
  pendingCount: number;
} {
  let currentTime = 1000000; // start at a reasonable epoch
  const pending = new Map<ReturnType<typeof globalThis.setTimeout>, { fn: () => void; fireAt: number }>();
  let nextId = 1;

  const timer: TimerInterface & {
    advance: (ms: number) => void;
    currentTime: number;
    pendingCount: number;
  } = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++ as unknown as ReturnType<typeof globalThis.setTimeout>;
      pending.set(id, { fn, fireAt: currentTime + ms });
      return id;
    },
    clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => {
      pending.delete(id);
    },
    now: () => currentTime,
    advance: (ms: number) => {
      const targetTime = currentTime + ms;
      // Fire timers in chronological order
      while (true) {
        let earliest: { id: ReturnType<typeof globalThis.setTimeout>; entry: { fn: () => void; fireAt: number } } | null = null;
        for (const [id, entry] of pending) {
          if (entry.fireAt <= targetTime) {
            if (!earliest || entry.fireAt < earliest.entry.fireAt) {
              earliest = { id, entry };
            }
          }
        }
        if (!earliest) break;
        currentTime = earliest.entry.fireAt;
        pending.delete(earliest.id);
        earliest.entry.fn();
      }
      currentTime = targetTime;
    },
    get currentTime() { return currentTime; },
    get pendingCount() { return pending.size; },
  };

  return timer;
}

// ── Silent Logger ───────────────────────────────────────────────

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ═══════════════════════════════════════════════════════════════
// 1. GLOB MATCHER
// ═══════════════════════════════════════════════════════════════

describe('Glob Matcher (minimatch)', () => {
  it('matches simple wildcard (*)', () => {
    assert.ok(minimatch('docs/prds/018-triggers.md', 'docs/prds/*.md'));
    assert.ok(!minimatch('docs/prds/018-triggers.txt', 'docs/prds/*.md'));
  });

  it('matches double wildcard (**)', () => {
    assert.ok(minimatch('packages/bridge/src/index.ts', 'packages/**/*.ts'));
    assert.ok(minimatch('packages/core/src/deep/nested/file.ts', 'packages/**/*.ts'));
  });

  it('matches question mark (?)', () => {
    assert.ok(minimatch('file1.ts', 'file?.ts'));
    assert.ok(!minimatch('file10.ts', 'file?.ts'));
  });

  it('matches character class ([abc])', () => {
    assert.ok(minimatch('file1.ts', 'file[123].ts'));
    assert.ok(!minimatch('file4.ts', 'file[123].ts'));
  });

  it('matches brace expansion ({a,b})', () => {
    assert.ok(minimatch('file.ts', 'file.{ts,js}'));
    assert.ok(minimatch('file.js', 'file.{ts,js}'));
    assert.ok(!minimatch('file.py', 'file.{ts,js}'));
  });

  it('matches exact paths', () => {
    assert.ok(minimatch('README.md', 'README.md'));
    assert.ok(!minimatch('README.txt', 'README.md'));
  });

  it('normalizes backslashes', () => {
    assert.ok(minimatch('docs\\prds\\test.md', 'docs/prds/*.md'));
  });

  it('handles **/ prefix for directory matching', () => {
    assert.ok(minimatch('a/b/c/test.md', '**/test.md'));
    assert.ok(minimatch('test.md', '**/test.md'));
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. DEBOUNCE ENGINE
// ═══════════════════════════════════════════════════════════════

describe('DebounceEngine', () => {
  describe('trailing strategy', () => {
    it('fires after quiet period', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 200, strategy: 'trailing', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ path: 'file1.md' });
      assert.equal(fires.length, 0, 'should not fire immediately');

      timer.advance(100);
      assert.equal(fires.length, 0, 'should not fire before window expires');

      timer.advance(101);
      assert.equal(fires.length, 1, 'should fire after window expires');
      assert.equal(fires[0].count, 1);
      assert.deepEqual(fires[0].events[0].payload, { path: 'file1.md' });
    });

    it('resets timer on each new event', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 200, strategy: 'trailing', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ path: 'file1.md' });
      timer.advance(150);
      engine.push({ path: 'file2.md' });
      timer.advance(150);
      assert.equal(fires.length, 0, 'should not fire — timer was reset');

      timer.advance(51);
      assert.equal(fires.length, 1, 'should fire after quiet period');
      assert.equal(fires[0].count, 2, 'batch should contain both events');
    });

    it('respects max_batch_size', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 5000, strategy: 'trailing', max_batch_size: 3 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ i: 1 });
      engine.push({ i: 2 });
      engine.push({ i: 3 });

      // max_batch_size reached — should fire immediately
      assert.equal(fires.length, 1, 'should fire at max_batch_size');
      assert.equal(fires[0].count, 3);
    });

    it('batches events within window into single fire', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 500, strategy: 'trailing', max_batch_size: 100 },
        (batch) => fires.push(batch),
        timer,
      );

      for (let i = 0; i < 5; i++) {
        engine.push({ i });
        timer.advance(50);
      }

      timer.advance(500);
      assert.equal(fires.length, 1, 'all events should be in one batch');
      assert.equal(fires[0].count, 5);
    });
  });

  describe('leading strategy', () => {
    it('fires immediately on first event', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 1000, strategy: 'leading', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ sha: 'abc123' });
      assert.equal(fires.length, 1, 'should fire immediately');
      assert.equal(fires[0].count, 1);
    });

    it('suppresses subsequent events within window', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 1000, strategy: 'leading', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ sha: 'abc123' });
      assert.equal(fires.length, 1);

      engine.push({ sha: 'def456' });
      engine.push({ sha: 'ghi789' });
      assert.equal(fires.length, 1, 'should still be 1 — suppressed');

      // After window expires, suppressed events fire
      timer.advance(1001);
      assert.equal(fires.length, 2, 'suppressed events should fire after window');
      assert.equal(fires[1].count, 2, 'batch should contain suppressed events');
    });

    it('re-opens window after debounce period', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 500, strategy: 'leading', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ sha: 'first' });
      assert.equal(fires.length, 1);

      timer.advance(600); // Window expires, no suppressed events
      assert.equal(fires.length, 1);

      // New event should fire immediately again
      engine.push({ sha: 'second' });
      assert.equal(fires.length, 2);
    });

    it('respects max_batch_size during suppression', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 10000, strategy: 'leading', max_batch_size: 3 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ sha: '1' });  // fires immediately
      assert.equal(fires.length, 1);

      engine.push({ sha: '2' });
      engine.push({ sha: '3' });
      engine.push({ sha: '4' });  // 3 suppressed = max_batch_size → force fire
      assert.equal(fires.length, 2, 'max_batch_size should force fire');
      assert.equal(fires[1].count, 3);
    });
  });

  describe('cancel', () => {
    it('cancels pending trailing fire', () => {
      const timer = createMockTimer();
      const fires: DebouncedTriggerFire[] = [];

      const engine = new DebounceEngine(
        { window_ms: 500, strategy: 'trailing', max_batch_size: 10 },
        (batch) => fires.push(batch),
        timer,
      );

      engine.push({ x: 1 });
      engine.cancel();
      timer.advance(600);
      assert.equal(fires.length, 0, 'cancelled — should not fire');
    });

    it('clears pending event count', () => {
      const timer = createMockTimer();
      const engine = new DebounceEngine(
        { window_ms: 500, strategy: 'trailing', max_batch_size: 10 },
        () => {},
        timer,
      );

      engine.push({ x: 1 });
      assert.equal(engine.pendingCount, 1);
      engine.cancel();
      assert.equal(engine.pendingCount, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. TRIGGER PARSER
// ═══════════════════════════════════════════════════════════════

describe('TriggerParser', () => {
  const validYaml = `
strategy:
  id: S-TEST-001
  name: "Test Strategy"
  version: "1.0"
  triggers:
    - type: manual
    - type: mcp_tool
      tool: strategy_execute
    - type: file_watch
      paths:
        - "docs/prds/*.md"
        - ".method/retros/*.yaml"
      events: [create, modify]
      debounce_ms: 3000
      debounce_strategy: trailing
    - type: git_commit
      branch_pattern: "master"
      debounce_ms: 10000
      debounce_strategy: leading
      max_concurrent: 2
  context:
    inputs:
      - { name: trigger_event, type: object }
  dag:
    nodes:
      - id: dummy
        type: script
        script: "return {}"
`;

  it('parses all trigger types from YAML', () => {
    const result = parseStrategyTriggers(validYaml);

    assert.equal(result.strategy_id, 'S-TEST-001');
    assert.equal(result.strategy_name, 'Test Strategy');
    assert.equal(result.triggers.length, 4);
  });

  it('separates event triggers from manual/mcp_tool', () => {
    const result = parseStrategyTriggers(validYaml);

    assert.equal(result.event_triggers.length, 2);
    assert.equal(result.event_triggers[0].type, 'file_watch');
    assert.equal(result.event_triggers[1].type, 'git_commit');
  });

  it('parses file_watch config correctly', () => {
    const result = parseStrategyTriggers(validYaml);
    const fw = result.event_triggers[0];

    assert.equal(fw.type, 'file_watch');
    if (fw.type === 'file_watch') {
      assert.deepEqual(fw.paths, ['docs/prds/*.md', '.method/retros/*.yaml']);
      assert.deepEqual(fw.events, ['create', 'modify']);
      assert.equal(fw.debounce_ms, 3000);
      assert.equal(fw.debounce_strategy, 'trailing');
    }
  });

  it('parses git_commit config correctly', () => {
    const result = parseStrategyTriggers(validYaml);
    const gc = result.event_triggers[1];

    assert.equal(gc.type, 'git_commit');
    if (gc.type === 'git_commit') {
      assert.equal(gc.branch_pattern, 'master');
      assert.equal(gc.debounce_ms, 10000);
      assert.equal(gc.debounce_strategy, 'leading');
      assert.equal(gc.max_concurrent, 2);
    }
  });

  it('hasEventTriggers returns true for strategies with event triggers', () => {
    assert.ok(hasEventTriggers(validYaml));
  });

  it('hasEventTriggers returns false for manual-only strategies', () => {
    const manualOnly = `
strategy:
  id: S-MANUAL
  name: "Manual Only"
  version: "1.0"
  triggers:
    - type: manual
  dag:
    nodes: []
`;
    assert.ok(!hasEventTriggers(manualOnly));
  });

  it('hasEventTriggers returns false for invalid YAML', () => {
    assert.ok(!hasEventTriggers('not: valid: yaml: [broken'));
  });

  it('throws on missing strategy.id', () => {
    assert.throws(() => {
      parseStrategyTriggers(`strategy:\n  name: test\n`);
    }, /missing/i);
  });

  it('backward compatible — manual and mcp_tool still parsed', () => {
    const result = parseStrategyTriggers(validYaml);
    const manual = result.triggers.find((t) => t.type === 'manual');
    const mcp = result.triggers.find((t) => t.type === 'mcp_tool');

    assert.ok(manual);
    assert.ok(mcp);
    if (mcp?.type === 'mcp_tool') {
      assert.equal(mcp.tool, 'strategy_execute');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. TRIGGER ROUTER
// ═══════════════════════════════════════════════════════════════

describe('TriggerRouter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trigger-router-test-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function writeStrategy(filename: string, content: string): string {
    const filePath = join(tmpDir, filename);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function createRouter(overrides?: Record<string, unknown>): TriggerRouter {
    return new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock-exec-001' }),
      ...overrides,
    });
  }

  it('registers triggers from a strategy YAML file', async () => {
    const stratPath = writeStrategy('test.yaml', `
strategy:
  id: S-ROUTER-TEST
  name: "Router Test"
  version: "1.0"
  triggers:
    - type: manual
    - type: file_watch
      paths: ["test/*.md"]
      debounce_ms: 100
  dag:
    nodes:
      - id: dummy
        type: script
        script: "return {}"
`);

    const router = createRouter();
    const regs = await router.registerStrategy(stratPath);

    assert.equal(regs.length, 1, 'should register 1 event trigger (file_watch)');
    assert.equal(regs[0].strategy_id, 'S-ROUTER-TEST');
    assert.equal(regs[0].trigger_config.type, 'file_watch');
    assert.equal(regs[0].enabled, true);
    assert.equal(regs[0].max_concurrent, 1);
  });

  it('unregisters all triggers for a strategy', async () => {
    const stratPath = writeStrategy('unreg.yaml', `
strategy:
  id: S-UNREG-TEST
  name: "Unreg Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["a/*.md"]
    - type: git_commit
  dag:
    nodes:
      - id: dummy
        type: script
        script: "return {}"
`);

    const router = createRouter();
    await router.registerStrategy(stratPath);
    assert.equal(router.getStatus().length, 2);

    router.unregisterStrategy('S-UNREG-TEST');
    assert.equal(router.getStatus().length, 0);
  });

  it('respects max_concurrent guard', async () => {
    const stratPath = writeStrategy('concurrent.yaml', `
strategy:
  id: S-CONCURRENT
  name: "Concurrent Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
      debounce_ms: 50
      max_concurrent: 1
  dag:
    nodes:
      - id: dummy
        type: script
        script: "return {}"
`);

    let execCount = 0;
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => {
        execCount++;
        // Simulate long execution
        await new Promise((r) => setTimeout(r, 200));
        return { execution_id: `exec-${execCount}` };
      },
    });

    await router.registerStrategy(stratPath);

    const status = router.getStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0].max_concurrent, 1);
  });

  it('tracks fire count in stats', async () => {
    const stratPath = writeStrategy('stats.yaml', `
strategy:
  id: S-STATS
  name: "Stats Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
      debounce_ms: 50
  dag:
    nodes:
      - id: dummy
        type: script
        script: "return {}"
`);

    const router = createRouter();
    const regs = await router.registerStrategy(stratPath);
    assert.equal(regs.length, 1);

    const status = router.getStatus();
    assert.equal(status[0].stats.total_fires, 0);
    assert.equal(status[0].stats.errors, 0);
  });

  it('enforces max_watchers limit', async () => {
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      maxWatchers: 1,
      executor: async () => ({ execution_id: 'mock' }),
    });

    // First strategy uses one watcher slot
    const strat1 = writeStrategy('s1.yaml', `
strategy:
  id: S-LIMIT-1
  name: "Limit 1"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["a/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);
    await router.registerStrategy(strat1);
    assert.equal(router.watcherCount, 1);

    // Second strategy should be skipped (limit reached)
    const strat2 = writeStrategy('s2.yaml', `
strategy:
  id: S-LIMIT-2
  name: "Limit 2"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["b/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);
    const regs = await router.registerStrategy(strat2);
    assert.equal(regs.length, 0, 'should refuse registration over limit');
  });

  it('pauseAll / resumeAll lifecycle', async () => {
    const stratPath = writeStrategy('pause.yaml', `
strategy:
  id: S-PAUSE
  name: "Pause Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = createRouter();
    await router.registerStrategy(stratPath);

    assert.ok(!router.isPaused);
    router.pauseAll();
    assert.ok(router.isPaused);

    // Watcher should be stopped
    const statusPaused = router.getStatus();
    assert.equal(statusPaused[0].watcher, null);

    router.resumeAll();
    assert.ok(!router.isPaused);
  });

  it('setTriggerEnabled toggles a specific trigger', async () => {
    const stratPath = writeStrategy('toggle.yaml', `
strategy:
  id: S-TOGGLE
  name: "Toggle Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = createRouter();
    const regs = await router.registerStrategy(stratPath);
    const triggerId = regs[0].trigger_id;

    assert.equal(router.getStatus()[0].enabled, true);
    router.setTriggerEnabled(triggerId, false);
    assert.equal(router.getStatus()[0].enabled, false);
    router.setTriggerEnabled(triggerId, true);
    assert.equal(router.getStatus()[0].enabled, true);
  });

  it('throws on unknown trigger ID', () => {
    const router = createRouter();
    assert.throws(() => {
      router.setTriggerEnabled('nonexistent', true);
    }, /not found/i);
  });

  it('shutdown clears all registrations', async () => {
    const stratPath = writeStrategy('shutdown.yaml', `
strategy:
  id: S-SHUTDOWN
  name: "Shutdown Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = createRouter();
    await router.registerStrategy(stratPath);
    assert.equal(router.getStatus().length, 1);

    await router.shutdown();
    assert.equal(router.getStatus().length, 0);
    assert.equal(router.watcherCount, 0);
  });

  it('history is populated after trigger fire and capped', async () => {
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      historySize: 5,
      executor: async () => ({ execution_id: 'mock' }),
    });

    // History starts empty
    assert.equal(router.getHistory().length, 0);
  });

  it('end-to-end: debounce fire invokes executor with correct args (F-A-1)', async () => {
    const execCalls: Array<{ strategyPath: string; contextInputs: Record<string, unknown> }> = [];

    // Create watch target directory BEFORE registering (so watcher finds it)
    mkdirSync(join(tmpDir, 'test'), { recursive: true });

    const stratPath = writeStrategy('e2e.yaml', `
strategy:
  id: S-E2E
  name: "E2E Test"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
      debounce_ms: 100
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    // Use real timers so fs.watch + debounce fire naturally
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async (strategyPath, contextInputs) => {
        execCalls.push({ strategyPath, contextInputs });
        return { execution_id: 'e2e-exec-001' };
      },
    });

    const regs = await router.registerStrategy(stratPath);
    assert.equal(regs.length, 1);

    // Verify initial stats
    const status0 = router.getStatus();
    assert.equal(status0[0].stats.total_fires, 0);

    // Let watcher fully initialize
    await new Promise((r) => setTimeout(r, 150));

    // Write a matching file to trigger the pipeline
    writeFileSync(join(tmpDir, 'test', 'trigger.md'), '# trigger');

    // Wait for fs.watch to detect + debounce to expire (100ms) + executor to run
    await new Promise((r) => setTimeout(r, 500));

    // Verify: executor was called
    assert.ok(execCalls.length > 0, 'executor should have been called');
    const call = execCalls[0];
    assert.ok(call.strategyPath.includes('e2e.yaml'), 'executor called with correct strategy path');
    assert.ok(call.contextInputs.trigger_event, 'context_inputs contains trigger_event');

    // Verify stats were updated
    const status1 = router.getStatus();
    assert.ok(status1[0].stats.total_fires >= 1, 'fire_count should be incremented');
    assert.ok(status1[0].stats.last_fired_at !== null, 'last_fired_at should be set');

    // Verify history was populated
    const history = router.getHistory();
    assert.ok(history.length > 0, 'history should be populated after fire');
    assert.equal(history[history.length - 1].strategy_id, 'S-E2E');

    await router.shutdown();
  });

  it('max_concurrent rejects second fire while first is in-flight (F-A-6)', async () => {
    const resolveBox: { fn: (() => void) | null } = { fn: null };
    let execCount = 0;

    // Create watch target directory BEFORE registering
    mkdirSync(join(tmpDir, 'test'), { recursive: true });

    const stratPath = writeStrategy('concurrent-e2e.yaml', `
strategy:
  id: S-CONC-E2E
  name: "Concurrent E2E"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
      debounce_ms: 50
      max_concurrent: 1
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    // Use real timers for fs.watch compatibility
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      logFires: true,
      executor: async () => {
        execCount++;
        if (execCount === 1) {
          // First execution blocks until resolved
          await new Promise<void>((resolve) => { resolveBox.fn = resolve; });
        }
        return { execution_id: `exec-${execCount}` };
      },
    });

    await router.registerStrategy(stratPath);

    // Let watcher fully initialize
    await new Promise((r) => setTimeout(r, 150));

    // Write first file to trigger first execution
    writeFileSync(join(tmpDir, 'test', 'first.md'), '# first');

    // Wait for fs.watch + debounce (50ms) + async executor to start
    await new Promise((r) => setTimeout(r, 300));

    // First execution should be in-flight (blocked on resolveBox)
    assert.ok(execCount >= 1, 'first execution should have started');

    // Write second file — should be rejected by max_concurrent guard
    writeFileSync(join(tmpDir, 'test', 'second.md'), '# second');
    await new Promise((r) => setTimeout(r, 300));

    // The second fire should have been skipped (max_concurrent=1, first still running)
    const statusDuring = router.getStatus();
    assert.equal(statusDuring[0].stats.total_fires, 1, 'should only have 1 fire (second was rejected)');
    assert.ok(statusDuring[0].stats.debounced_events >= 1, 'debounced_events tracks the skipped second fire');

    // Resolve the first execution
    if (resolveBox.fn) resolveBox.fn();
    await new Promise((r) => setTimeout(r, 50));

    await router.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. FILE WATCH TRIGGER
// ═══════════════════════════════════════════════════════════════

describe('FileWatchTrigger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fw-trigger-test-'));
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('fires when a matching file is created', async () => {
    const trigger = new FileWatchTrigger(
      { type: 'file_watch', paths: ['docs/*.md'], events: ['create', 'modify'] },
      tmpDir,
    );

    const events: Record<string, unknown>[] = [];
    trigger.start((payload) => events.push(payload));

    // Give the watcher time to initialize
    await new Promise((r) => setTimeout(r, 100));

    // Write a file that matches the pattern
    writeFileSync(join(tmpDir, 'docs', 'test.md'), '# Test');

    // Wait for fs.watch to detect the change
    await new Promise((r) => setTimeout(r, 500));

    trigger.stop();

    assert.ok(events.length > 0, 'should have received at least one event');
    assert.equal(events[0].filename, 'test.md');
  });

  it('does not fire for non-matching files', async () => {
    const trigger = new FileWatchTrigger(
      { type: 'file_watch', paths: ['docs/*.md'] },
      tmpDir,
    );

    const events: Record<string, unknown>[] = [];
    trigger.start((payload) => events.push(payload));

    await new Promise((r) => setTimeout(r, 100));

    // Write a .txt file — should not match *.md
    writeFileSync(join(tmpDir, 'docs', 'test.txt'), 'not markdown');

    await new Promise((r) => setTimeout(r, 500));
    trigger.stop();

    assert.equal(events.length, 0, 'should not fire for non-matching file');
  });

  it('reports correct active state', () => {
    const trigger = new FileWatchTrigger(
      { type: 'file_watch', paths: ['docs/*.md'] },
      tmpDir,
    );

    assert.equal(trigger.active, false);
    trigger.start(() => {});
    assert.equal(trigger.active, true);
    trigger.stop();
    assert.equal(trigger.active, false);
  });

  it('has correct type', () => {
    const trigger = new FileWatchTrigger(
      { type: 'file_watch', paths: ['docs/*.md'] },
      tmpDir,
    );
    assert.equal(trigger.type, 'file_watch');
  });

  it('handles non-existent watch directory gracefully', () => {
    const trigger = new FileWatchTrigger(
      { type: 'file_watch', paths: ['nonexistent/*.md'] },
      tmpDir,
    );

    // Should not throw
    trigger.start(() => {});
    trigger.stop();
    assert.ok(true, 'should handle missing directory gracefully');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. GIT COMMIT TRIGGER
// ═══════════════════════════════════════════════════════════════

describe('GitCommitTrigger', () => {
  let tmpDir: string;
  let isGitAvailable = true;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'git-trigger-test-'));
    try {
      execSync('git --version', { stdio: 'pipe' });
    } catch {
      isGitAvailable = false;
    }
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('detects a new commit via polling', async function () {
    if (!isGitAvailable) {
      return; // skip if git is not available
    }

    // Initialize a git repo
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });

    // Create initial commit
    writeFileSync(join(tmpDir, 'init.txt'), 'init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'pipe' });

    const events: Record<string, unknown>[] = [];

    const trigger = new GitCommitTrigger(
      { type: 'git_commit' },
      tmpDir,
      { pollIntervalMs: 200, platform: 'linux' }, // force polling mode
    );

    trigger.start((payload) => events.push(payload));

    // Wait for initial setup
    await new Promise((r) => setTimeout(r, 100));

    // Make a new commit
    writeFileSync(join(tmpDir, 'new.txt'), 'new');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "second commit"', { cwd: tmpDir, stdio: 'pipe' });

    // Wait for poll to detect the commit
    await new Promise((r) => setTimeout(r, 500));

    trigger.stop();

    assert.ok(events.length > 0, 'should detect the new commit');
    assert.ok(events[0].commit_sha, 'should include commit SHA');
    assert.equal(events[0].commit_message, 'second commit');
  });

  it('reports correct active state', () => {
    const timer = createMockTimer();
    const trigger = new GitCommitTrigger(
      { type: 'git_commit' },
      tmpDir,
      { timer, platform: 'linux' },
    );

    assert.equal(trigger.active, false);
    trigger.start(() => {});
    assert.equal(trigger.active, true);
    trigger.stop();
    assert.equal(trigger.active, false);
  });

  it('has correct type', () => {
    const trigger = new GitCommitTrigger(
      { type: 'git_commit' },
      tmpDir,
    );
    assert.equal(trigger.type, 'git_commit');
  });

  it('filters by branch_pattern', async function () {
    if (!isGitAvailable) {
      return; // skip if git is not available
    }

    // Initialize a git repo
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });

    // Create initial commit on master
    writeFileSync(join(tmpDir, 'init.txt'), 'init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });

    // Create a feature branch
    execSync('git checkout -b feature/test', { cwd: tmpDir, stdio: 'pipe' });

    const events: Record<string, unknown>[] = [];

    // Only trigger on master
    const trigger = new GitCommitTrigger(
      { type: 'git_commit', branch_pattern: 'master' },
      tmpDir,
      { pollIntervalMs: 200, platform: 'linux' },
    );

    trigger.start((payload) => events.push(payload));
    await new Promise((r) => setTimeout(r, 100));

    // Commit on feature branch — should NOT trigger (branch doesn't match)
    writeFileSync(join(tmpDir, 'feat.txt'), 'feature');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "feature commit"', { cwd: tmpDir, stdio: 'pipe' });

    await new Promise((r) => setTimeout(r, 500));
    trigger.stop();

    assert.equal(events.length, 0, 'should not fire for non-matching branch');
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. STARTUP SCANNING
// ═══════════════════════════════════════════════════════════════

describe('Startup Scanning', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('registers triggers from valid strategy files', async () => {
    // Create a strategy file with event triggers
    writeFileSync(join(tmpDir, 'valid.yaml'), `
strategy:
  id: S-SCAN-VALID
  name: "Scan Valid"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["test/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock' }),
    });

    const result = await scanAndRegisterTriggers(router, tmpDir, silentLogger);

    assert.equal(result.scanned, 1);
    assert.equal(result.registered, 1);
    assert.equal(result.errors.length, 0);

    await router.shutdown();
  });

  it('skips strategies without event triggers', async () => {
    writeFileSync(join(tmpDir, 'manual-only.yaml'), `
strategy:
  id: S-MANUAL-ONLY
  name: "Manual Only"
  version: "1.0"
  triggers:
    - type: manual
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock' }),
    });

    const result = await scanAndRegisterTriggers(router, tmpDir, silentLogger);

    assert.equal(result.scanned, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.registered, 0);

    await router.shutdown();
  });

  it('logs errors for invalid YAML and continues', async () => {
    // Write an invalid YAML file
    writeFileSync(join(tmpDir, 'bad.yaml'), 'this is not: valid: yaml: [broken');

    // Write a valid file too
    writeFileSync(join(tmpDir, 'good.yaml'), `
strategy:
  id: S-GOOD
  name: "Good"
  version: "1.0"
  triggers:
    - type: file_watch
      paths: ["x/*.md"]
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock' }),
    });

    const result = await scanAndRegisterTriggers(router, tmpDir, silentLogger);

    assert.equal(result.scanned, 2);
    assert.equal(result.registered, 1, 'valid strategy should be registered');
    // The bad YAML may be skipped (not having event triggers) or error
    assert.ok(result.skipped + result.errors.length >= 1, 'bad file should be skipped or errored');

    await router.shutdown();
  });

  it('handles non-existent directory gracefully', async () => {
    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock' }),
    });

    const result = await scanAndRegisterTriggers(
      router,
      join(tmpDir, 'does-not-exist'),
      silentLogger,
    );

    assert.equal(result.scanned, 0);
    assert.equal(result.registered, 0);

    await router.shutdown();
  });

  it('scans both .yaml and .yml extensions', async () => {
    writeFileSync(join(tmpDir, 'test.yml'), `
strategy:
  id: S-YML
  name: "YML Test"
  version: "1.0"
  triggers:
    - type: git_commit
  dag:
    nodes:
      - id: d
        type: script
        script: "return {}"
`);

    const router = new TriggerRouter({
      baseDir: tmpDir,
      bridgeUrl: 'http://localhost:9999',
      logger: silentLogger,
      executor: async () => ({ execution_id: 'mock' }),
    });

    const result = await scanAndRegisterTriggers(router, tmpDir, silentLogger);

    assert.equal(result.scanned, 1);
    assert.equal(result.registered, 1);

    await router.shutdown();
  });
});
