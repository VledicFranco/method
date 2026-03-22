import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScopeViolationMatcher } from '../pattern-matchers.js';
import { createPtyWatcher, parseWatcherConfig, stripAnsiCodes } from '../pty-watcher.js';
import { createSessionChannels, readMessages } from '../channels.js';

// ── Scope Violation Pattern Matcher Tests (PRD 014 Phase 2) ────

describe('createScopeViolationMatcher (PRD 014)', () => {
  it('returns no violations when allowed_paths is empty', () => {
    const matcher = createScopeViolationMatcher([]);
    const matches = matcher('Write file at packages/core/src/index.ts');
    assert.equal(matches.length, 0);
  });

  it('detects Write to out-of-scope file', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    const matches = matcher('Write file_path: "packages/core/src/index.ts"');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, 'scope_violation');
    assert.equal(matches[0].channelTarget, 'events');
    assert.equal(matches[0].messageType, 'scope_violation');
    assert.equal(matches[0].content.path, 'packages/core/src/index.ts');
    assert.equal(matches[0].content.operation, 'write');
    assert.deepEqual(matches[0].content.allowed_patterns, ['packages/bridge/**']);
  });

  it('detects Edit to out-of-scope file', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    const matches = matcher('Edit file_path: "registry/method.yaml"');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, 'scope_violation');
    assert.equal(matches[0].content.path, 'registry/method.yaml');
    assert.equal(matches[0].content.operation, 'edit');
  });

  it('does NOT flag Write to in-scope file (SC-8: no false positives)', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    const matches = matcher('Write file_path: "packages/bridge/src/pool.ts"');
    assert.equal(matches.length, 0);
  });

  it('does NOT flag Edit to in-scope file (SC-8)', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/src/**', 'packages/mcp/src/**']);
    const matches = matcher('Edit file_path: "packages/bridge/src/index.ts"');
    assert.equal(matches.length, 0);
  });

  it('does NOT flag Read operations (SC-5: read unrestricted)', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    // The matcher regex only matches Write/Edit, not Read
    const matches = matcher('Read file at packages/core/src/index.ts');
    assert.equal(matches.length, 0);
  });

  it('detects multiple out-of-scope files in one chunk', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    const text = [
      'Write file_path: "packages/core/src/index.ts"',
      'Edit file_path: ".method/project-card.yaml"',
    ].join('\n');
    const matches = matcher(text);
    assert.equal(matches.length, 2);
    assert.equal(matches[0].content.path, 'packages/core/src/index.ts');
    assert.equal(matches[1].content.path, '.method/project-card.yaml');
  });

  it('deduplicates same file path in one chunk', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**']);
    const text = [
      'Write file_path: "packages/core/src/index.ts"',
      'Write file_path: "packages/core/src/index.ts"',  // duplicate
    ].join('\n');
    const matches = matcher(text);
    assert.equal(matches.length, 1);
  });

  it('handles mixed in-scope and out-of-scope operations', () => {
    const matcher = createScopeViolationMatcher(['packages/bridge/**', 'docs/prds/*.md']);
    const text = [
      'Write file_path: "packages/bridge/src/pool.ts"',    // in-scope
      'Edit file_path: "packages/core/src/index.ts"',      // out-of-scope
      'Write file_path: "docs/prds/014-scope.md"',         // in-scope
      'Edit file_path: ".method/council/AGENDA.yaml"',     // out-of-scope
    ].join('\n');
    const matches = matcher(text);
    assert.equal(matches.length, 2);
    const paths = matches.map(m => m.content.path);
    assert.ok(paths.includes('packages/core/src/index.ts'));
    assert.ok(paths.includes('.method/council/AGENDA.yaml'));
  });

  it('includes allowed_patterns in violation content', () => {
    const patterns = ['packages/bridge/**', 'packages/mcp/**'];
    const matcher = createScopeViolationMatcher(patterns);
    const matches = matcher('Write file_path: "registry/P2-SD.yaml"');
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].content.allowed_patterns, patterns);
  });
});

// ── PTY Watcher Integration with Scope Violation ──────────────

describe('PtyWatcher scope_violation integration (PRD 014 SC-2)', () => {
  it('emits scope_violation event when agent writes to out-of-scope file', () => {
    const channels = createSessionChannels();
    const outputCallbacks: ((data: string) => void)[] = [];

    const config = parseWatcherConfig({
      PTY_WATCHER_ENABLED: 'true',
      PTY_WATCHER_PATTERNS: 'all',
      PTY_WATCHER_RATE_LIMIT_MS: '0',     // No rate limiting for tests
      PTY_WATCHER_DEDUP_WINDOW_MS: '0',   // No dedup for tests
    });

    const watcher = createPtyWatcher(
      'test-session-scope',
      channels,
      (cb) => { outputCallbacks.push(cb); return () => {}; },
      config,
      undefined,
      ['packages/bridge/**'],  // allowed_paths
    );

    // Simulate agent writing to an out-of-scope file
    for (const cb of outputCallbacks) {
      cb('Write file_path: "packages/core/src/index.ts"\n');
    }

    // Check events channel for scope_violation
    const events = readMessages(channels.events, 0);
    const scopeViolations = events.messages.filter(m => m.type === 'scope_violation');
    assert.ok(scopeViolations.length > 0, 'Should emit scope_violation event');
    assert.equal(scopeViolations[0].content.path, 'packages/core/src/index.ts');

    watcher.detach();
  });

  it('does NOT emit scope_violation for in-scope Write (SC-8)', () => {
    const channels = createSessionChannels();
    const outputCallbacks: ((data: string) => void)[] = [];

    const config = parseWatcherConfig({
      PTY_WATCHER_ENABLED: 'true',
      PTY_WATCHER_PATTERNS: 'all',
      PTY_WATCHER_RATE_LIMIT_MS: '0',
      PTY_WATCHER_DEDUP_WINDOW_MS: '0',
    });

    const watcher = createPtyWatcher(
      'test-session-scope-ok',
      channels,
      (cb) => { outputCallbacks.push(cb); return () => {}; },
      config,
      undefined,
      ['packages/bridge/**'],
    );

    // Simulate agent writing to an in-scope file
    for (const cb of outputCallbacks) {
      cb('Write file_path: "packages/bridge/src/pool.ts"\n');
    }

    // Check events channel — should have no scope_violation
    const events = readMessages(channels.events, 0);
    const scopeViolations = events.messages.filter(m => m.type === 'scope_violation');
    assert.equal(scopeViolations.length, 0, 'Should NOT emit scope_violation for in-scope file');

    watcher.detach();
  });

  it('does NOT emit scope_violation when no allowed_paths configured (SC-4)', () => {
    const channels = createSessionChannels();
    const outputCallbacks: ((data: string) => void)[] = [];

    const config = parseWatcherConfig({
      PTY_WATCHER_ENABLED: 'true',
      PTY_WATCHER_PATTERNS: 'all',
      PTY_WATCHER_RATE_LIMIT_MS: '0',
      PTY_WATCHER_DEDUP_WINDOW_MS: '0',
    });

    // No allowed_paths — backwards compatible
    const watcher = createPtyWatcher(
      'test-session-no-scope',
      channels,
      (cb) => { outputCallbacks.push(cb); return () => {}; },
      config,
    );

    // Simulate agent writing anywhere
    for (const cb of outputCallbacks) {
      cb('Write file_path: "registry/P2-SD.yaml"\n');
    }

    // No scope_violation events should exist
    const events = readMessages(channels.events, 0);
    const scopeViolations = events.messages.filter(m => m.type === 'scope_violation');
    assert.equal(scopeViolations.length, 0, 'Should NOT emit scope_violation when no allowed_paths');

    watcher.detach();
  });

  it('records scope_violation in observations for auto-retro', () => {
    const channels = createSessionChannels();
    const outputCallbacks: ((data: string) => void)[] = [];

    const config = parseWatcherConfig({
      PTY_WATCHER_ENABLED: 'true',
      PTY_WATCHER_PATTERNS: 'all',
      PTY_WATCHER_RATE_LIMIT_MS: '0',
      PTY_WATCHER_DEDUP_WINDOW_MS: '0',
    });

    const watcher = createPtyWatcher(
      'test-session-obs',
      channels,
      (cb) => { outputCallbacks.push(cb); return () => {}; },
      config,
      undefined,
      ['packages/bridge/**'],
    );

    for (const cb of outputCallbacks) {
      cb('Edit file_path: ".method/project-card.yaml"\n');
    }

    // Check that the observation was recorded
    const scopeObs = watcher.observations.filter(o => o.category === 'scope_violation');
    assert.ok(scopeObs.length > 0, 'Should record scope_violation observation');
    assert.equal(scopeObs[0].detail.path, '.method/project-card.yaml');

    watcher.detach();
  });

  it('invokes onObservation callback for scope_violation', () => {
    const channels = createSessionChannels();
    const outputCallbacks: ((data: string) => void)[] = [];
    const observedMatches: Array<{ category: string; isIdle: boolean }> = [];

    const config = parseWatcherConfig({
      PTY_WATCHER_ENABLED: 'true',
      PTY_WATCHER_PATTERNS: 'all',
      PTY_WATCHER_RATE_LIMIT_MS: '0',
      PTY_WATCHER_DEDUP_WINDOW_MS: '0',
    });

    const watcher = createPtyWatcher(
      'test-session-callback',
      channels,
      (cb) => { outputCallbacks.push(cb); return () => {}; },
      config,
      (match, isIdle) => {
        observedMatches.push({ category: match.category, isIdle });
      },
      ['packages/bridge/**'],
    );

    for (const cb of outputCallbacks) {
      cb('Write file_path: "packages/core/src/loader.ts"\n');
    }

    const scopeCallbacks = observedMatches.filter(o => o.category === 'scope_violation');
    assert.ok(scopeCallbacks.length > 0, 'Should invoke onObservation for scope_violation');
    assert.equal(scopeCallbacks[0].isIdle, false);

    watcher.detach();
  });
});
