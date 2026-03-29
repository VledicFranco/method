/**
 * Secrets Resolution — Unit Tests
 *
 * Tests the 1Password CLI (op run) integration and fallback logic
 * added to start-bridge.js by PRD 038 C-3.
 *
 * These are pure unit tests of the resolution logic — no bridge process
 * is started, no 1Password CLI is invoked.
 *
 * Run: node --test scripts/__tests__/secrets-resolution.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnvFile } from '../lib/profile-loader.js';

// ── Helpers ─────────────────────────────────────────────────────

/** Project root — two levels up from scripts/__tests__/ */
const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Replicate the secrets resolution logic from start-bridge.js
 * as a pure function for testing. This mirrors the decision tree
 * in the launch script without side effects (no console.log, no spawn).
 *
 * @param {{ hasEnvTpl: boolean, hasOp: boolean, hasEnv: boolean }} opts
 * @returns {{ secretsMode: 'op-run' | 'env-file' | 'none', warnings: string[] }}
 */
function resolveSecrets({ hasEnvTpl, hasOp, hasEnv }) {
  const warnings = [];
  let secretsMode = 'none';

  if (hasEnvTpl && hasOp) {
    secretsMode = 'op-run';
  } else if (hasEnvTpl && !hasOp) {
    warnings.push('op CLI not found \u2014 falling back to .env');
    if (hasEnv) {
      secretsMode = 'env-file';
    } else {
      secretsMode = 'none';
      warnings.push('Secrets: none configured (no .env found)');
    }
  } else if (hasEnv) {
    secretsMode = 'env-file';
  } else {
    secretsMode = 'none';
    warnings.push('Secrets: none configured');
  }

  return { secretsMode, warnings };
}

/**
 * Build the spawn arguments for a given secrets mode, mirroring
 * the spawn logic in start-bridge.js.
 *
 * @param {'op-run' | 'env-file' | 'none'} secretsMode
 * @param {string} serverEntry
 * @returns {{ command: string, args: string[] }}
 */
function buildSpawnArgs(secretsMode, serverEntry) {
  if (secretsMode === 'op-run') {
    return {
      command: 'op',
      args: ['run', '--env-file=.env.tpl', '--', 'node', serverEntry],
    };
  }
  return {
    command: 'node',
    args: [serverEntry],
  };
}

// ── Scenario 1 (AC-5): op available + .env.tpl exists → op run ──

describe('secrets resolution: op available + .env.tpl exists', () => {
  it('selects op-run mode when op is available and .env.tpl exists', () => {
    const result = resolveSecrets({ hasEnvTpl: true, hasOp: true, hasEnv: false });
    assert.equal(result.secretsMode, 'op-run');
    assert.equal(result.warnings.length, 0);
  });

  it('selects op-run mode even when .env also exists', () => {
    const result = resolveSecrets({ hasEnvTpl: true, hasOp: true, hasEnv: true });
    assert.equal(result.secretsMode, 'op-run');
    // op-run takes priority — .env is not loaded
  });

  it('builds spawn args with op run wrapping node', () => {
    const serverEntry = 'packages/bridge/dist/server-entry.js';
    const { command, args } = buildSpawnArgs('op-run', serverEntry);
    assert.equal(command, 'op');
    assert.deepEqual(args, [
      'run',
      '--env-file=.env.tpl',
      '--',
      'node',
      serverEntry,
    ]);
  });
});

// ── Scenario 2 (AC-6): op NOT available + .env exists → fallback ──

describe('secrets resolution: op not available, .env fallback', () => {
  it('falls back to env-file mode when op is not available but .env exists', () => {
    const result = resolveSecrets({ hasEnvTpl: true, hasOp: false, hasEnv: true });
    assert.equal(result.secretsMode, 'env-file');
    assert.ok(
      result.warnings.some((w) => w.includes('op CLI not found')),
      'should warn about missing op CLI'
    );
  });

  it('uses env-file mode when no .env.tpl exists but .env does', () => {
    const result = resolveSecrets({ hasEnvTpl: false, hasOp: false, hasEnv: true });
    assert.equal(result.secretsMode, 'env-file');
    assert.equal(result.warnings.length, 0);
  });

  it('builds spawn args with plain node (no op wrapper)', () => {
    const serverEntry = 'packages/bridge/dist/server-entry.js';
    const { command, args } = buildSpawnArgs('env-file', serverEntry);
    assert.equal(command, 'node');
    assert.deepEqual(args, [serverEntry]);
  });

  it('parseEnvFile correctly loads .env content for fallback', () => {
    const content = [
      '# API keys',
      'ANTHROPIC_API_KEY=sk-ant-test-123',
      'VOYAGE_API_KEY=pa-test-456',
    ].join('\n');
    const env = parseEnvFile(content);
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test-123');
    assert.equal(env.VOYAGE_API_KEY, 'pa-test-456');
  });
});

// ── Scenario 3 (AC-7): no .env.tpl, no .env, no op → none ──────

describe('secrets resolution: no secrets configured', () => {
  it('returns none when no .env.tpl and no .env exist', () => {
    const result = resolveSecrets({ hasEnvTpl: false, hasOp: false, hasEnv: false });
    assert.equal(result.secretsMode, 'none');
    assert.ok(
      result.warnings.some((w) => w.includes('none configured')),
      'should warn about no secrets configured'
    );
  });

  it('returns none when .env.tpl exists, op is missing, and no .env exists', () => {
    const result = resolveSecrets({ hasEnvTpl: true, hasOp: false, hasEnv: false });
    assert.equal(result.secretsMode, 'none');
    assert.ok(
      result.warnings.some((w) => w.includes('op CLI not found')),
      'should warn about missing op CLI'
    );
  });

  it('builds spawn args with plain node when mode is none', () => {
    const serverEntry = 'packages/bridge/dist/server-entry.js';
    const { command, args } = buildSpawnArgs('none', serverEntry);
    assert.equal(command, 'node');
    assert.deepEqual(args, [serverEntry]);
  });
});

// ── .env.tpl file integrity ─────────────────────────────────────

describe('.env.tpl file', () => {
  it('exists in the project root', () => {
    const tplPath = join(PROJECT_ROOT, '.env.tpl');
    assert.ok(existsSync(tplPath), '.env.tpl should exist in project root');
  });

  it('contains op:// references (not actual secrets)', () => {
    const tplPath = join(PROJECT_ROOT, '.env.tpl');
    const content = readFileSync(tplPath, 'utf-8');

    // Should contain op:// references
    assert.ok(content.includes('op://'), '.env.tpl should contain op:// references');

    // Parse it — values should be op:// URIs, not real secrets
    const env = parseEnvFile(content);
    for (const [key, value] of Object.entries(env)) {
      assert.ok(
        value.startsWith('op://'),
        `${key} should have an op:// reference, got: ${value}`
      );
    }
  });

  it('has the expected secret keys', () => {
    const tplPath = join(PROJECT_ROOT, '.env.tpl');
    const content = readFileSync(tplPath, 'utf-8');
    const env = parseEnvFile(content);

    assert.ok('ANTHROPIC_API_KEY' in env, 'should define ANTHROPIC_API_KEY');
    assert.ok('VOYAGE_API_KEY' in env, 'should define VOYAGE_API_KEY');
  });
});
