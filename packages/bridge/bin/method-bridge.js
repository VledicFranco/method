#!/usr/bin/env node
// CLI entry point for the method-bridge portable distribution.
// Composition root: parses flags, loads instance profiles, spawns the bundled server.
//
// This file is designed to work in an installed context (from a tarball) without
// workspace dependencies. Profile loading logic is inlined — it cannot import from
// scripts/lib/ at install time.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Flag Parsing ───────────────────────────────────────────────

const args = process.argv.slice(2);

/**
 * Extract a flag value from argv. Returns null if not found.
 * @param {string} flag
 * @returns {string | null}
 */
function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(flag) {
  return args.includes(flag);
}

// ── Help ───────────────────────────────────────────────────────

if (hasFlag('--help') || hasFlag('-h')) {
  const usage = `
method-bridge — Method Bridge server CLI

Usage:
  method-bridge [options]

Options:
  --instance <name>   Load instance profile from .method/instances/<name>.env
  --port <number>     Override the server port (default: 3456)
  --help, -h          Show this help message and exit

Instance Profiles:
  Instance profiles are .env files in .method/instances/ that configure isolated
  bridge instances. Each profile can set PORT, ROOT_DIR, EVENT_LOG_PATH,
  INSTANCE_NAME, and other environment variables.

  Profiles are loaded from the current working directory's .method/instances/.

Examples:
  method-bridge                        Start with defaults (port 3456)
  method-bridge --instance production  Start with the production profile
  method-bridge --instance test        Start with the test profile (port 3457)
  method-bridge --port 4000            Start on port 4000

Environment Variables:
  PORT              Server port (default: 3456)
  INSTANCE_NAME     Human-readable instance identifier
  ROOT_DIR          Project discovery root directory
  EVENT_LOG_PATH    Path to the event persistence log
  ANTHROPIC_API_KEY Anthropic API key for LLM operations
  VOYAGE_API_KEY    Voyage API key for embeddings
`.trim();

  console.log(usage);
  process.exit(0);
}

// ── Inline Profile Loader ──────────────────────────────────────
// Inlined from scripts/lib/profile-loader.js — simple KEY=VALUE .env parser.
// Cannot import the original module in an installed (tarball) context.

const PATH_KEYS = new Set(['ROOT_DIR', 'EVENT_LOG_PATH']);

/**
 * Parse a .env file content string into a key-value object.
 * Supports KEY=VALUE lines, # comments, empty lines, quoted values.
 * Does NOT support variable expansion.
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
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
 * @param {Record<string, string>} env
 * @returns {Record<string, string>}
 */
function normalizePathValues(env) {
  const result = { ...env };
  for (const key of PATH_KEYS) {
    if (result[key]) {
      result[key] = result[key].replace(/\\/g, '/');
    }
  }
  return result;
}

// ── Instance Profile Loading ───────────────────────────────────

const instanceName = getFlag('--instance');
let profileEnv = {};

if (instanceName) {
  const profilePath = resolve(process.cwd(), '.method', 'instances', `${instanceName}.env`);

  if (!existsSync(profilePath)) {
    console.error(
      `\x1b[31m[method-bridge]\x1b[0m Instance profile not found: ${profilePath}\n` +
      `Create .method/instances/${instanceName}.env to define this instance.`
    );
    process.exit(1);
  }

  try {
    const content = readFileSync(profilePath, 'utf-8');
    const raw = parseEnvFile(content);
    profileEnv = normalizePathValues(raw);
    console.log(`\x1b[36m[method-bridge]\x1b[0m Instance profile loaded: ${instanceName} (${profilePath})`);
  } catch (err) {
    console.error(`\x1b[31m[method-bridge]\x1b[0m Failed to load instance profile "${instanceName}": ${err.message}`);
    process.exit(1);
  }
}

// ── Port Override ──────────────────────────────────────────────

const portOverride = getFlag('--port');
if (portOverride) {
  const portNum = parseInt(portOverride, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    console.error(`\x1b[31m[method-bridge]\x1b[0m Invalid port: ${portOverride} (must be 1-65535)`);
    process.exit(1);
  }
  profileEnv.PORT = String(portNum);
}

// ── Resolve Bundle Path ────────────────────────────────────────

// In installed context, the bundle is at ../dist-bundle/server-entry.js relative to bin/
const bundlePath = join(__dirname, '..', 'dist-bundle', 'server-entry.js');

if (!existsSync(bundlePath)) {
  console.error(
    `\x1b[31m[method-bridge]\x1b[0m Bundled server not found: ${bundlePath}\n` +
    `The bridge bundle has not been built. Run 'node scripts/pack-bridge.js' from the project root.`
  );
  process.exit(1);
}

// ── Merge Environment ──────────────────────────────────────────

const env = { ...process.env };

// Profile values fill in missing keys (explicit env vars take precedence)
for (const [key, value] of Object.entries(profileEnv)) {
  if (!(key in env) || env[key] === undefined) {
    env[key] = value;
  }
}

// ── Spawn Server ───────────────────────────────────────────────

const resolvedPort = env.PORT || '3456';
const resolvedInstance = env.INSTANCE_NAME || instanceName || 'default';

console.log(`\x1b[36m[method-bridge]\x1b[0m Starting bridge (instance: ${resolvedInstance}, port: ${resolvedPort})`);

const child = spawn(process.execPath, [bundlePath], {
  env,
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('error', (err) => {
  console.error(`\x1b[31m[method-bridge]\x1b[0m Failed to start server: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

// Forward signals for graceful shutdown
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
