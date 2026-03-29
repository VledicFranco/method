/**
 * Portable Packaging — Unit Tests
 *
 * Tests the packaging script and CLI entry point for the method-bridge
 * portable distribution (PRD 038 Phase 3).
 *
 * Scenario 1: pack-bridge.js is valid JS and can be loaded without error.
 * Scenario 2: method-bridge.js --help exits with code 0 and prints usage.
 *
 * Run: node --test scripts/__tests__/pack-bridge.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// ── Helpers ─────────────────────────────────────────────────────

/** Project root — two levels up from scripts/__tests__/ */
const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

const PACK_SCRIPT = join(PROJECT_ROOT, 'scripts', 'pack-bridge.js');
const CLI_ENTRY = join(PROJECT_ROOT, 'packages', 'bridge', 'bin', 'method-bridge.js');

// ── Scenario 1: pack-bridge.js is valid JS ──────────────────────

describe('pack-bridge.js', () => {
  it('exists at the expected path', () => {
    assert.ok(
      existsSync(PACK_SCRIPT),
      `pack-bridge.js not found at: ${PACK_SCRIPT}`
    );
  });

  it('is syntactically valid JavaScript (can be checked by Node)', () => {
    // Use --check flag to validate syntax without executing
    try {
      execFileSync(process.execPath, ['--check', PACK_SCRIPT], {
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch (err) {
      assert.fail(
        `pack-bridge.js has syntax errors:\n${err.stderr?.toString() || err.message}`
      );
    }
  });
});

// ── Scenario 2: method-bridge.js --help exits cleanly ───────────

describe('method-bridge.js --help', () => {
  it('exists at the expected path', () => {
    assert.ok(
      existsSync(CLI_ENTRY),
      `method-bridge.js not found at: ${CLI_ENTRY}`
    );
  });

  it('exits with code 0 and prints usage text', () => {
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [CLI_ENTRY, '--help'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
    } catch (err) {
      assert.fail(
        `method-bridge.js --help exited with code ${err.status}:\n` +
        `stdout: ${err.stdout}\nstderr: ${err.stderr}`
      );
    }

    // Verify usage text contains key elements
    assert.ok(
      stdout.includes('method-bridge'),
      'Usage text should contain "method-bridge"'
    );
    assert.ok(
      stdout.includes('--instance'),
      'Usage text should document the --instance flag'
    );
    assert.ok(
      stdout.includes('--port'),
      'Usage text should document the --port flag'
    );
    assert.ok(
      stdout.includes('--help'),
      'Usage text should document the --help flag'
    );
  });

  it('also accepts -h as a help flag', () => {
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [CLI_ENTRY, '-h'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
    } catch (err) {
      assert.fail(
        `method-bridge.js -h exited with code ${err.status}:\n` +
        `stdout: ${err.stdout}\nstderr: ${err.stderr}`
      );
    }

    assert.ok(
      stdout.includes('method-bridge'),
      'Short -h flag should also print usage text'
    );
  });
});
