// Secrets resolution logic — determines how API keys and secrets are provided
// to the bridge process. Extracted from start-bridge.js for testability.
//
// Resolution modes:
//   'op-run'   — .env.tpl exists and 1Password CLI (op) is available
//   'env-file' — .env file exists (either as fallback or primary)
//   'none'     — no secrets source configured

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Detect whether the 1Password CLI (`op`) is available on PATH.
 * @returns {boolean}
 */
export function isOpAvailable() {
  try {
    const cmd = process.platform === 'win32' ? 'where op' : 'which op';
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {'op-run' | 'env-file' | 'none'} SecretsMode
 */

/**
 * Resolve which secrets mode should be used given the available files and tools.
 *
 * Logic mirrors start-bridge.js:
 *   1. .env.tpl + op available → 'op-run'
 *   2. .env.tpl without op, but .env exists → 'env-file' (fallback)
 *   3. No .env.tpl, but .env exists → 'env-file'
 *   4. Neither → 'none'
 *
 * @param {{ hasEnvTpl: boolean, hasEnv: boolean, hasOp: boolean }} inputs
 * @returns {SecretsMode}
 */
export function resolveSecretsMode({ hasEnvTpl, hasEnv, hasOp }) {
  if (hasEnvTpl && hasOp) {
    return 'op-run';
  }

  if (hasEnvTpl && !hasOp && hasEnv) {
    return 'env-file';
  }

  if (!hasEnvTpl && hasEnv) {
    return 'env-file';
  }

  // .env.tpl without op and no .env, or nothing at all
  return 'none';
}

/**
 * Detect secrets mode by probing the filesystem and PATH.
 *
 * @param {string} envTplPath — absolute path to .env.tpl
 * @param {string} envPath    — absolute path to .env
 * @returns {SecretsMode}
 */
export function detectSecretsMode(envTplPath, envPath) {
  const hasEnvTpl = existsSync(envTplPath);
  const hasEnv = existsSync(envPath);
  const hasOp = hasEnvTpl ? isOpAvailable() : false;

  return resolveSecretsMode({ hasEnvTpl, hasEnv, hasOp });
}
