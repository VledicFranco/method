#!/usr/bin/env node
// Profile loader — resolves and parses .env instance profiles.
// Profiles live at .method/instances/<name>.env and provide env vars
// for bridge isolation (port, root dir, event log path, etc.).

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Path values that should have Windows backslashes normalized to forward slashes (DR-06)
const PATH_KEYS = new Set(['ROOT_DIR', 'EVENT_LOG_PATH']);

/**
 * Parse a .env file content string into a key-value object.
 * Supports:
 *   - KEY=VALUE lines (whitespace around = is trimmed)
 *   - Comment lines starting with #
 *   - Empty lines (skipped)
 *   - Quoted values (single or double quotes are stripped)
 *
 * Does NOT support variable expansion ($VAR or ${VAR}).
 */
export function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    // Find the first = sign (key cannot contain =, value can)
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Normalize Windows backslashes to forward slashes in path-type values.
 * Only applies to keys in PATH_KEYS set.
 */
export function normalizePathValues(env) {
  const result = { ...env };
  for (const key of PATH_KEYS) {
    if (result[key]) {
      result[key] = result[key].replace(/\\/g, '/');
    }
  }
  return result;
}

/**
 * Resolve the .env file path for a named instance.
 * Looks in .method/instances/<name>.env relative to the project root.
 *
 * @param {string} instanceName - Name of the instance (e.g., "test", "production")
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {string} Absolute path to the .env file
 * @throws {Error} If the profile file does not exist
 */
export function resolveProfilePath(instanceName, projectRoot) {
  const root = projectRoot || process.cwd();
  const profilePath = resolve(root, '.method', 'instances', `${instanceName}.env`);

  if (!existsSync(profilePath)) {
    throw new Error(
      `Instance profile not found: ${profilePath}\n` +
      `Create .method/instances/${instanceName}.env to define this instance.`
    );
  }

  return profilePath;
}

/**
 * Load and parse an instance profile by name.
 * Returns the parsed env vars with path normalization applied.
 *
 * @param {string} instanceName - Name of the instance (e.g., "test", "production")
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {{ env: Record<string, string>, profilePath: string }}
 */
export function loadProfile(instanceName, projectRoot) {
  const profilePath = resolveProfilePath(instanceName, projectRoot);
  const content = readFileSync(profilePath, 'utf-8');
  const raw = parseEnvFile(content);
  const env = normalizePathValues(raw);

  return { env, profilePath };
}

/**
 * Merge profile env vars with process env.
 * Explicit env vars (already in process.env) take precedence over profile values.
 *
 * @param {Record<string, string>} profileEnv - Env vars from the profile
 * @param {Record<string, string | undefined>} [processEnv] - Current process env (defaults to process.env)
 * @returns {Record<string, string | undefined>} Merged env object
 */
export function mergeEnv(profileEnv, processEnv) {
  const base = processEnv ?? process.env;
  const merged = { ...base };

  for (const [key, value] of Object.entries(profileEnv)) {
    // Only set if not already explicitly defined in the process env
    if (!(key in base) || base[key] === undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Parse --instance <name> from a process.argv array.
 * Returns the instance name or null if not provided.
 *
 * @param {string[]} [argv] - Argument array (defaults to process.argv)
 * @returns {string | null}
 */
export function parseInstanceFlag(argv) {
  const args = argv ?? process.argv;
  const idx = args.indexOf('--instance');
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
