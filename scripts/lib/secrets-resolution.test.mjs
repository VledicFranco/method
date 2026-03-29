/**
 * Unit tests for secrets resolution logic (PRD 038 Phase 2).
 *
 * Tests the three resolution paths:
 *   AC-5: op available + .env.tpl → 'op-run'
 *   AC-6: op not available → falls back to .env → 'env-file'
 *   AC-7: neither .env.tpl nor .env → 'none'
 *
 * The pure resolution logic is tested via resolveSecretsMode() which
 * takes pre-computed boolean flags — no filesystem or PATH dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSecretsMode } from './secrets-resolver.js';

describe('secrets-resolution', () => {
  // ── AC-5: op available + .env.tpl → op-run ───────────────────

  describe('AC-5: 1Password op-run mode', () => {
    it('returns op-run when .env.tpl exists and op is available', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: true, hasEnv: true, hasOp: true });
      assert.equal(mode, 'op-run');
    });

    it('returns op-run even when .env does not exist (op handles everything)', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: true, hasEnv: false, hasOp: true });
      assert.equal(mode, 'op-run');
    });
  });

  // ── AC-6: op not available → falls back to .env ──────────────

  describe('AC-6: env-file fallback', () => {
    it('returns env-file when .env.tpl exists but op is not available, and .env exists', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: true, hasEnv: true, hasOp: false });
      assert.equal(mode, 'env-file');
    });

    it('returns env-file when no .env.tpl but .env exists', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: false, hasEnv: true, hasOp: false });
      assert.equal(mode, 'env-file');
    });
  });

  // ── AC-7: neither .env.tpl nor .env → none ───────────────────

  describe('AC-7: no secrets configured', () => {
    it('returns none when neither .env.tpl nor .env exists', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: false, hasEnv: false, hasOp: false });
      assert.equal(mode, 'none');
    });

    it('returns none when .env.tpl exists but op is unavailable and no .env fallback', () => {
      const mode = resolveSecretsMode({ hasEnvTpl: true, hasEnv: false, hasOp: false });
      assert.equal(mode, 'none');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('op availability is irrelevant when .env.tpl does not exist', () => {
      // Even if op is somehow "available", without .env.tpl it falls to .env or none
      const withEnv = resolveSecretsMode({ hasEnvTpl: false, hasEnv: true, hasOp: true });
      assert.equal(withEnv, 'env-file');

      const withoutEnv = resolveSecretsMode({ hasEnvTpl: false, hasEnv: false, hasOp: true });
      assert.equal(withoutEnv, 'none');
    });
  });
});
