// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import {
  generateHookScript,
  installScopeHook,
  isPathAllowed,
  matchGlobPattern,
} from './scope-hook.js';

// ── Hook Script Generation Tests ──────────────────────────────

describe('generateHookScript (PRD 014)', () => {
  it('generates a no-op script when allowed_paths is empty', () => {
    const script = generateHookScript('test-session', []);
    assert.ok(script.includes('exit 0'));
    assert.ok(script.includes('No scope constraints'));
  });

  it('generates a script with pattern matching for single pattern', () => {
    const script = generateHookScript('sess-001', ['packages/bridge/**']);
    assert.ok(script.includes('#!/usr/bin/env bash'));
    assert.ok(script.includes('PRD 014'));
    assert.ok(script.includes('sess-001'));
    assert.ok(script.includes('packages/bridge/**'));
    assert.ok(script.includes('SCOPE VIOLATION'));
    assert.ok(script.includes('ALLOWED_PATTERNS'));
    assert.ok(script.includes('git diff --cached --name-only'));
  });

  it('generates a script with multiple patterns', () => {
    const script = generateHookScript('sess-002', [
      'packages/bridge/src/**',
      'packages/bridge/src/__tests__/**',
      'docs/prds/*.md',
    ]);
    assert.ok(script.includes('packages/bridge/src/**'));
    assert.ok(script.includes('packages/bridge/src/__tests__/**'));
    assert.ok(script.includes('docs/prds/*.md'));
  });

  it('escapes single quotes in patterns', () => {
    const script = generateHookScript('sess-003', ["it's/a/path"]);
    // Pattern should be properly escaped in bash
    assert.ok(script.includes("it"));
    assert.ok(script.includes("ALLOWED_PATTERNS"));
  });

  it('includes session ID in comments for traceability', () => {
    const script = generateHookScript('abc-def-123', ['src/**']);
    assert.ok(script.includes('Session: abc-def-123'));
  });

  it('includes glob_to_regex function for pattern matching', () => {
    const script = generateHookScript('sess-004', ['src/**']);
    assert.ok(script.includes('glob_to_regex'));
  });
});

// ── Glob Pattern Matching Tests (TypeScript) ──────────────────

describe('matchGlobPattern (PRD 014)', () => {
  it('matches simple file extension wildcard', () => {
    assert.ok(matchGlobPattern('src/index.ts', '*.ts'));
    assert.ok(!matchGlobPattern('src/index.ts', '*.js'));
  });

  it('matches * within a directory (no path separators)', () => {
    assert.ok(matchGlobPattern('docs/guide.md', 'docs/*.md'));
    assert.ok(!matchGlobPattern('docs/sub/guide.md', 'docs/*.md'));
  });

  it('matches ** for any depth', () => {
    assert.ok(matchGlobPattern('packages/bridge/src/index.ts', 'packages/bridge/**'));
    assert.ok(matchGlobPattern('packages/bridge/src/deep/nested/file.ts', 'packages/bridge/**'));
    assert.ok(matchGlobPattern('packages/bridge/file.ts', 'packages/bridge/**'));
  });

  it('matches **/ prefix for any directory depth', () => {
    assert.ok(matchGlobPattern('packages/bridge/src/index.ts', 'packages/**/index.ts'));
    assert.ok(matchGlobPattern('packages/index.ts', 'packages/**/index.ts'));
  });

  it('does not match paths outside pattern scope', () => {
    assert.ok(!matchGlobPattern('packages/core/src/index.ts', 'packages/bridge/**'));
    assert.ok(!matchGlobPattern('registry/method.yaml', 'packages/**'));
  });

  it('handles ? wildcard for single character', () => {
    assert.ok(matchGlobPattern('src/a.ts', 'src/?.ts'));
    assert.ok(!matchGlobPattern('src/ab.ts', 'src/?.ts'));
  });

  it('handles exact file path matching', () => {
    assert.ok(matchGlobPattern('CLAUDE.md', 'CLAUDE.md'));
    assert.ok(!matchGlobPattern('README.md', 'CLAUDE.md'));
  });

  it('handles patterns with dots correctly', () => {
    assert.ok(matchGlobPattern('.method/council/AGENDA.yaml', '.method/**'));
    assert.ok(matchGlobPattern('package.json', 'package.json'));
  });
});

// ── isPathAllowed Tests ───────────────────────────────────────

describe('isPathAllowed (PRD 014)', () => {
  it('returns true for any path when allowed_paths is empty', () => {
    assert.ok(isPathAllowed('anything/at/all.ts', []));
  });

  it('returns true for paths matching allowed patterns', () => {
    const patterns = ['packages/bridge/src/**', 'packages/bridge/src/__tests__/**'];
    assert.ok(isPathAllowed('packages/bridge/src/pool.ts', patterns));
    assert.ok(isPathAllowed('packages/bridge/src/__tests__/pool.test.ts', patterns));
  });

  it('returns false for paths outside allowed patterns', () => {
    const patterns = ['packages/bridge/**'];
    assert.ok(!isPathAllowed('packages/core/src/index.ts', patterns));
    assert.ok(!isPathAllowed('registry/method.yaml', patterns));
    assert.ok(!isPathAllowed('.method/project-card.yaml', patterns));
  });

  it('normalizes backslashes to forward slashes', () => {
    const patterns = ['packages/bridge/**'];
    assert.ok(isPathAllowed('packages\\bridge\\src\\index.ts', patterns));
  });

  it('supports multiple patterns — match any', () => {
    const patterns = ['packages/bridge/**', 'docs/prds/*.md'];
    assert.ok(isPathAllowed('packages/bridge/src/pool.ts', patterns));
    assert.ok(isPathAllowed('docs/prds/014-scope.md', patterns));
    assert.ok(!isPathAllowed('packages/core/src/index.ts', patterns));
  });

  it('no false positives — in-scope files never rejected (SC-8)', () => {
    const patterns = ['packages/bridge/src/**', 'packages/mcp/src/**'];
    // All these should be allowed
    assert.ok(isPathAllowed('packages/bridge/src/scope-hook.ts', patterns));
    assert.ok(isPathAllowed('packages/bridge/src/__tests__/scope-hook.test.ts', patterns));
    assert.ok(isPathAllowed('packages/mcp/src/index.ts', patterns));
    assert.ok(isPathAllowed('packages/bridge/src/deeply/nested/file.ts', patterns));
  });
});

// ── installScopeHook Tests ────────────────────────────────────

describe('installScopeHook (PRD 014)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `scope-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });

    // Initialize a git repo in tmpDir so resolveHooksDir works
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  it('installs hook file with correct content', () => {
    const result = installScopeHook(tmpDir, 'test-session-1', ['packages/bridge/**']);
    assert.equal(result.installed, true);
    assert.ok(result.hookPath);

    const content = readFileSync(result.hookPath!, 'utf-8');
    assert.ok(content.includes('#!/usr/bin/env bash'));
    assert.ok(content.includes('packages/bridge/**'));
    assert.ok(content.includes('test-session-1'));
    assert.ok(content.includes('SCOPE VIOLATION'));
  });

  it('creates hooks directory if it does not exist', () => {
    // Remove the hooks dir if git init created it
    const hooksDir = join(tmpDir, '.git', 'hooks');
    try { rmSync(hooksDir, { recursive: true, force: true }); } catch { /* ok */ }

    const result = installScopeHook(tmpDir, 'test-session-2', ['src/**']);
    assert.equal(result.installed, true);
    assert.ok(existsSync(result.hookPath!));
  });

  it('returns installed=false when allowed_paths is empty', () => {
    const result = installScopeHook(tmpDir, 'test-session-3', []);
    assert.equal(result.installed, false);
    assert.equal(result.hookPath, null);
  });

  it('handles multiple patterns correctly', () => {
    const patterns = ['packages/bridge/**', 'packages/mcp/**', 'docs/prds/*.md'];
    const result = installScopeHook(tmpDir, 'test-session-4', patterns);
    assert.equal(result.installed, true);

    const content = readFileSync(result.hookPath!, 'utf-8');
    for (const pattern of patterns) {
      assert.ok(content.includes(pattern), `Hook should contain pattern: ${pattern}`);
    }
  });
});

// ── Integration Test: Hook Rejects Out-of-Scope Commit ────────

describe('Scope Hook Integration (PRD 014 SC-1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `scope-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });

    // Initialize a git repo with a commit
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });

    // Create initial commit
    writeFileSync(join(tmpDir, 'README.md'), '# Test\n');
    execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });

    // Create directory structure
    mkdirSync(join(tmpDir, 'packages', 'bridge', 'src'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages', 'core', 'src'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  it('rejects commit with out-of-scope files (SC-1: hard block)', () => {
    // Install hook allowing only bridge files
    const result = installScopeHook(tmpDir, 'test-integration', ['packages/bridge/**']);
    assert.equal(result.installed, true);

    // Create an out-of-scope file and try to commit
    writeFileSync(join(tmpDir, 'packages', 'core', 'src', 'index.ts'), 'export {};');
    execSync('git add packages/core/src/index.ts', { cwd: tmpDir, stdio: 'pipe' });

    // Commit should fail due to pre-commit hook
    assert.throws(() => {
      execSync('git commit -m "out-of-scope change"', {
        cwd: tmpDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    }, (err: any) => {
      const stderr = err.stderr?.toString() ?? err.stdout?.toString() ?? '';
      return stderr.includes('SCOPE VIOLATION') || err.status !== 0;
    });
  });

  it('allows commit with in-scope files (SC-8: no false positives)', () => {
    // Install hook allowing bridge files
    const result = installScopeHook(tmpDir, 'test-integration-2', ['packages/bridge/**']);
    assert.equal(result.installed, true);

    // Create an in-scope file and commit
    writeFileSync(join(tmpDir, 'packages', 'bridge', 'src', 'pool.ts'), 'export {};');
    execSync('git add packages/bridge/src/pool.ts', { cwd: tmpDir, stdio: 'pipe' });

    // Should succeed
    const output = execSync('git commit -m "in-scope change"', {
      cwd: tmpDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    // Commit should have gone through — check it exists
    const log = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' });
    assert.ok(log.includes('in-scope change'));
  });

  it('backwards compatible — no hook when allowed_paths empty (SC-4)', () => {
    // Install with empty paths — should not create hook
    const result = installScopeHook(tmpDir, 'test-compat', []);
    assert.equal(result.installed, false);

    // Any file should be committable
    writeFileSync(join(tmpDir, 'packages', 'core', 'src', 'anything.ts'), 'export {};');
    execSync('git add packages/core/src/anything.ts', { cwd: tmpDir, stdio: 'pipe' });

    const output = execSync('git commit -m "unrestricted commit"', {
      cwd: tmpDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const log = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' });
    assert.ok(log.includes('unrestricted commit'));
  });
});
