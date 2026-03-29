/**
 * Instance Profile System — Unit Tests
 *
 * Tests the profile-loader module that powers --instance flag isolation.
 * These are pure unit tests of the loader — no bridge process is started.
 *
 * Run: node --test scripts/__tests__/instance-profiles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  parseEnvFile,
  normalizePathValues,
  resolveProfilePath,
  loadProfile,
  mergeEnv,
  parseInstanceFlag,
} from '../lib/profile-loader.js';

// ── Helpers ─────────────────────────────────────────────────────

/** Project root — two levels up from scripts/__tests__/ */
const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

// ── Scenario 1: Parse .env file content ─────────────────────────

describe('parseEnvFile', () => {
  it('parses KEY=VALUE pairs', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux');
    assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comment lines', () => {
    const result = parseEnvFile('# This is a comment\nFOO=bar\n# Another comment');
    assert.deepEqual(result, { FOO: 'bar' });
  });

  it('ignores empty lines', () => {
    const result = parseEnvFile('\nFOO=bar\n\n\nBAZ=qux\n');
    assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
  });

  it('handles mixed content (comments, empty lines, values)', () => {
    const content = [
      '# Instance config',
      '',
      'INSTANCE_NAME=test',
      '# Port for the server',
      'PORT=3457',
      '',
      'GENESIS_ENABLED=false',
    ].join('\n');

    const result = parseEnvFile(content);
    assert.deepEqual(result, {
      INSTANCE_NAME: 'test',
      PORT: '3457',
      GENESIS_ENABLED: 'false',
    });
  });

  it('strips surrounding double quotes from values', () => {
    const result = parseEnvFile('FOO="hello world"');
    assert.equal(result.FOO, 'hello world');
  });

  it('strips surrounding single quotes from values', () => {
    const result = parseEnvFile("FOO='hello world'");
    assert.equal(result.FOO, 'hello world');
  });

  it('preserves = signs in values', () => {
    const result = parseEnvFile('CONNECTION=host=localhost;port=5432');
    assert.equal(result.CONNECTION, 'host=localhost;port=5432');
  });

  it('trims whitespace around keys and values', () => {
    const result = parseEnvFile('  FOO  =  bar  ');
    assert.deepEqual(result, { FOO: 'bar' });
  });

  it('skips lines without = sign', () => {
    const result = parseEnvFile('INVALID_LINE\nFOO=bar');
    assert.deepEqual(result, { FOO: 'bar' });
  });
});

// ── Scenario 2: Resolve named instance to .env path ─────────────

describe('resolveProfilePath', () => {
  it('resolves an existing instance profile path', () => {
    const path = resolveProfilePath('production', PROJECT_ROOT);
    assert.ok(path.endsWith('.env'));
    assert.ok(path.includes('production.env'));
  });

  it('resolves the test instance profile', () => {
    const path = resolveProfilePath('test', PROJECT_ROOT);
    assert.ok(path.includes('test.env'));
  });
});

// ── Scenario 3: Error for nonexistent instance ──────────────────

describe('resolveProfilePath — missing instance', () => {
  it('throws an error for a nonexistent instance name', () => {
    assert.throws(
      () => resolveProfilePath('nonexistent-instance-xyz', PROJECT_ROOT),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Instance profile not found'));
        assert.ok(err.message.includes('nonexistent-instance-xyz.env'));
        return true;
      }
    );
  });
});

// ── Scenario 4: Windows path normalization ──────────────────────

describe('normalizePathValues', () => {
  it('normalizes backslashes to forward slashes in ROOT_DIR', () => {
    const env = { ROOT_DIR: 'C:\\Users\\test\\project', PORT: '3456' };
    const result = normalizePathValues(env);
    assert.equal(result.ROOT_DIR, 'C:/Users/test/project');
    // Non-path keys are untouched
    assert.equal(result.PORT, '3456');
  });

  it('normalizes backslashes in EVENT_LOG_PATH', () => {
    const env = { EVENT_LOG_PATH: 'C:\\temp\\events.jsonl' };
    const result = normalizePathValues(env);
    assert.equal(result.EVENT_LOG_PATH, 'C:/temp/events.jsonl');
  });

  it('leaves forward slashes untouched', () => {
    const env = { ROOT_DIR: '/home/user/project' };
    const result = normalizePathValues(env);
    assert.equal(result.ROOT_DIR, '/home/user/project');
  });

  it('does not modify non-path keys even if they contain backslashes', () => {
    const env = { INSTANCE_NAME: 'test\\value' };
    const result = normalizePathValues(env);
    assert.equal(result.INSTANCE_NAME, 'test\\value');
  });
});

// ── Scenario 5: Merge profile env with process env ──────────────

describe('mergeEnv', () => {
  it('profile values fill in missing keys', () => {
    const profileEnv = { PORT: '3457', INSTANCE_NAME: 'test' };
    const processEnv = { HOME: '/home/user' };
    const merged = mergeEnv(profileEnv, processEnv);

    assert.equal(merged.PORT, '3457');
    assert.equal(merged.INSTANCE_NAME, 'test');
    assert.equal(merged.HOME, '/home/user');
  });

  it('explicit process env vars take precedence over profile', () => {
    const profileEnv = { PORT: '3457', INSTANCE_NAME: 'test' };
    const processEnv = { PORT: '9999', HOME: '/home/user' };
    const merged = mergeEnv(profileEnv, processEnv);

    // Process env wins
    assert.equal(merged.PORT, '9999');
    // Profile fills in the rest
    assert.equal(merged.INSTANCE_NAME, 'test');
  });

  it('does not overwrite any existing process env key', () => {
    const profileEnv = { NODE_ENV: 'test', DEBUG: 'true' };
    const processEnv = { NODE_ENV: 'production', PATH: '/usr/bin' };
    const merged = mergeEnv(profileEnv, processEnv);

    assert.equal(merged.NODE_ENV, 'production'); // not overwritten
    assert.equal(merged.DEBUG, 'true'); // added from profile
    assert.equal(merged.PATH, '/usr/bin'); // preserved
  });
});

// ── Extra: parseInstanceFlag ────────────────────────────────────

describe('parseInstanceFlag', () => {
  it('extracts instance name from argv', () => {
    const name = parseInstanceFlag(['node', 'script.js', '--instance', 'test']);
    assert.equal(name, 'test');
  });

  it('returns null when no --instance flag is present', () => {
    const name = parseInstanceFlag(['node', 'script.js']);
    assert.equal(name, null);
  });

  it('returns null when --instance has no following value', () => {
    const name = parseInstanceFlag(['node', 'script.js', '--instance']);
    assert.equal(name, null);
  });

  it('handles --instance among other flags', () => {
    const name = parseInstanceFlag(['node', 'script.js', '--verbose', '--instance', 'production', '--port', '8080']);
    assert.equal(name, 'production');
  });
});

// ── Integration: loadProfile end-to-end ─────────────────────────

describe('loadProfile', () => {
  it('loads and parses the test profile with path normalization', () => {
    const { env, profilePath } = loadProfile('test', PROJECT_ROOT);

    assert.equal(env.INSTANCE_NAME, 'test');
    assert.equal(env.PORT, '3457');
    assert.equal(env.GENESIS_ENABLED, 'false');
    assert.equal(env.MAX_SESSIONS, '3');
    assert.ok(profilePath.includes('test.env'));
  });

  it('loads the production profile', () => {
    const { env } = loadProfile('production', PROJECT_ROOT);

    assert.equal(env.INSTANCE_NAME, 'production');
    assert.equal(env.PORT, '3456');
  });
});
