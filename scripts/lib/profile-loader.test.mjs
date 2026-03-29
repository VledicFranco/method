/**
 * Unit tests for scripts/lib/profile-loader.js (PRD 038 Phase 1).
 *
 * Validates instance profile loading, CLI flag parsing, error handling,
 * and env-var merge precedence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  loadProfile,
  parseInstanceFlag,
  mergeEnv,
  parseEnvFile,
  normalizePathValues,
  resolveProfilePath,
} from './profile-loader.js';

// Derive project root (two levels up from scripts/lib/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

describe('profile-loader', () => {
  // ── AC-1: --instance test loads test.env ─────────────────────

  describe('loadProfile', () => {
    it('AC-1: --instance test loads test.env with PORT=3457 and INSTANCE_NAME=test', () => {
      const { env, profilePath } = loadProfile('test', PROJECT_ROOT);

      assert.equal(env.PORT, '3457');
      assert.equal(env.INSTANCE_NAME, 'test');
      assert.ok(profilePath.includes('test.env'), `profilePath should contain test.env: ${profilePath}`);
    });

    it('loads production.env with PORT=3456 and INSTANCE_NAME=production', () => {
      const { env } = loadProfile('production', PROJECT_ROOT);

      assert.equal(env.PORT, '3456');
      assert.equal(env.INSTANCE_NAME, 'production');
    });
  });

  // ── AC-2: No --instance flag → null (backward compat) ───────

  describe('parseInstanceFlag', () => {
    it('AC-2: returns null when no --instance flag is present', () => {
      const result = parseInstanceFlag(['node', 'start-bridge.js']);
      assert.equal(result, null);
    });

    it('AC-2: returns instance name when --instance flag is present', () => {
      const result = parseInstanceFlag(['node', 'start-bridge.js', '--instance', 'test']);
      assert.equal(result, 'test');
    });

    it('returns null when --instance is the last arg (no value follows)', () => {
      const result = parseInstanceFlag(['node', 'start-bridge.js', '--instance']);
      assert.equal(result, null);
    });

    it('returns the first --instance value when multiple are provided', () => {
      const result = parseInstanceFlag(['node', 'start-bridge.js', '--instance', 'alpha', '--instance', 'beta']);
      assert.equal(result, 'alpha');
    });
  });

  // ── AC-3: Invalid instance name → throws ─────────────────────

  describe('resolveProfilePath — error handling', () => {
    it('AC-3: throws with clear message for nonexistent instance', () => {
      assert.throws(
        () => loadProfile('nonexistent', PROJECT_ROOT),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('Instance profile not found'),
            `Error message should contain "Instance profile not found": ${err.message}`
          );
          return true;
        }
      );
    });

    it('error message includes the expected file path', () => {
      assert.throws(
        () => resolveProfilePath('ghost', PROJECT_ROOT),
        (err) => {
          assert.ok(err.message.includes('ghost.env'), `Should mention file name: ${err.message}`);
          return true;
        }
      );
    });
  });

  // ── Env precedence: explicit env vars win over profile ────────

  describe('mergeEnv — precedence', () => {
    it('explicit env vars take precedence over profile values', () => {
      const merged = mergeEnv({ PORT: '3457' }, { PORT: '9999' });
      assert.equal(merged.PORT, '9999');
    });

    it('profile values fill in when not present in process env', () => {
      const merged = mergeEnv({ PORT: '3457' }, {});
      assert.equal(merged.PORT, '3457');
    });

    it('undefined values in process env are overwritten by profile', () => {
      const merged = mergeEnv({ PORT: '3457' }, { PORT: undefined });
      assert.equal(merged.PORT, '3457');
    });

    it('preserves all keys from both sources', () => {
      const merged = mergeEnv(
        { PORT: '3457', INSTANCE_NAME: 'test' },
        { HOME: '/home/user' }
      );
      assert.equal(merged.PORT, '3457');
      assert.equal(merged.INSTANCE_NAME, 'test');
      assert.equal(merged.HOME, '/home/user');
    });
  });

  // ── parseEnvFile unit tests ───────────────────────────────────

  describe('parseEnvFile', () => {
    it('parses KEY=VALUE lines', () => {
      const env = parseEnvFile('PORT=3457\nINSTANCE_NAME=test');
      assert.equal(env.PORT, '3457');
      assert.equal(env.INSTANCE_NAME, 'test');
    });

    it('skips comments and blank lines', () => {
      const env = parseEnvFile('# comment\n\nPORT=3457\n  # another comment\n');
      assert.equal(env.PORT, '3457');
      assert.equal(Object.keys(env).length, 1);
    });

    it('strips surrounding quotes from values', () => {
      const env = parseEnvFile('A="hello"\nB=\'world\'');
      assert.equal(env.A, 'hello');
      assert.equal(env.B, 'world');
    });

    it('handles values containing = signs', () => {
      const env = parseEnvFile('KEY=a=b=c');
      assert.equal(env.KEY, 'a=b=c');
    });
  });

  // ── normalizePathValues ───────────────────────────────────────

  describe('normalizePathValues', () => {
    it('converts backslashes to forward slashes in ROOT_DIR and EVENT_LOG_PATH', () => {
      const env = normalizePathValues({
        ROOT_DIR: 'C:\\Users\\test\\repos',
        EVENT_LOG_PATH: 'C:\\tmp\\events.jsonl',
        PORT: '3457',
      });
      assert.equal(env.ROOT_DIR, 'C:/Users/test/repos');
      assert.equal(env.EVENT_LOG_PATH, 'C:/tmp/events.jsonl');
      assert.equal(env.PORT, '3457'); // non-path key unchanged
    });

    it('leaves forward slashes untouched', () => {
      const env = normalizePathValues({ ROOT_DIR: '/home/test/repos' });
      assert.equal(env.ROOT_DIR, '/home/test/repos');
    });
  });
});
