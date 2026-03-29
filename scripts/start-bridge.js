#!/usr/bin/env node
// Bridge launcher — auto-loads CLAUDE_OAUTH_TOKEN from Claude Code credentials
// and passes it to the bridge process.
// Supports --instance <name> to load a profile from .method/instances/<name>.env
// Supports 1Password CLI (op run) for secrets resolution via .env.tpl

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { parseInstanceFlag, loadProfile, mergeEnv, parseEnvFile } from './lib/profile-loader.js';

// ── Instance profile loading ────────────────────────────────────

const instanceName = parseInstanceFlag();
let profileEnv = {};

if (instanceName) {
  try {
    const { env, profilePath } = loadProfile(instanceName);
    profileEnv = env;
    console.log(`\x1b[36m[bridge]\x1b[0m Instance profile loaded: ${instanceName} (${profilePath})`);
  } catch (err) {
    console.error(`\x1b[31m[bridge]\x1b[0m Failed to load instance profile "${instanceName}": ${err.message}`);
    process.exit(1);
  }
} else {
  console.log(`\x1b[36m[bridge]\x1b[0m Instance profile: default (no --instance flag)`);
}

// ── Secrets resolution ──────────────────────────────────────────
//
// Resolution order:
//   1. Instance profile env (already loaded above by C-1)
//   2. .env.tpl + op CLI → spawn via `op run --env-file=.env.tpl`
//   3. .env.tpl without op → warn and fall back to .env
//   4. .env → load with parseEnvFile
//   5. Neither → start without secrets
//

const envTplPath = join(process.cwd(), '.env.tpl');
const envPath = join(process.cwd(), '.env');

/**
 * Detect whether the 1Password CLI (`op`) is available on PATH.
 * @returns {boolean}
 */
function isOpAvailable() {
  try {
    const cmd = process.platform === 'win32' ? 'where op' : 'which op';
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasEnvTpl = existsSync(envTplPath);
const hasEnv = existsSync(envPath);
const hasOp = hasEnvTpl ? isOpAvailable() : false;

/** @type {'op-run' | 'env-file' | 'none'} */
let secretsMode = 'none';

if (hasEnvTpl && hasOp) {
  secretsMode = 'op-run';
  console.log(`\x1b[32m[bridge]\x1b[0m Secrets: resolving via 1Password (op run)`);
} else if (hasEnvTpl && !hasOp) {
  console.log(`\x1b[33m[bridge]\x1b[0m op CLI not found \u2014 falling back to .env`);
  if (hasEnv) {
    secretsMode = 'env-file';
    console.log(`\x1b[32m[bridge]\x1b[0m Secrets: loaded from .env`);
  } else {
    secretsMode = 'none';
    console.log(`\x1b[33m[bridge]\x1b[0m Secrets: none configured (no .env found)`);
  }
} else if (hasEnv) {
  secretsMode = 'env-file';
  console.log(`\x1b[32m[bridge]\x1b[0m Secrets: loaded from .env`);
} else {
  secretsMode = 'none';
  console.log(`\x1b[33m[bridge]\x1b[0m Secrets: none configured`);
}

// Load .env file secrets into profileEnv when using env-file mode
if (secretsMode === 'env-file') {
  const envContent = readFileSync(envPath, 'utf-8');
  const envSecrets = parseEnvFile(envContent);
  // Merge secrets into profileEnv (profile takes precedence over .env secrets)
  for (const [key, value] of Object.entries(envSecrets)) {
    if (!(key in profileEnv)) {
      profileEnv[key] = value;
    }
  }
}

const credentialsPath = join(homedir(), '.claude', '.credentials.json');

// ── Auto-detect OAuth token ──────────────────────────────────

let oauthToken = process.env.CLAUDE_OAUTH_TOKEN ?? null;
let tokenSource = 'env';

if (!oauthToken) {
  try {
    if (existsSync(credentialsPath)) {
      const creds = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
      const oauth = creds.claudeAiOauth;

      if (oauth?.accessToken) {
        // Check expiry
        if (oauth.expiresAt) {
          const expiresAt = new Date(oauth.expiresAt);
          if (expiresAt.getTime() < Date.now()) {
            console.log(`\x1b[33m[bridge]\x1b[0m OAuth token expired at ${expiresAt.toISOString()}`);
            console.log(`\x1b[33m[bridge]\x1b[0m Run 'claude' to refresh your token, then restart the bridge`);
            console.log(`\x1b[33m[bridge]\x1b[0m Starting without subscription meters\n`);
            oauthToken = null;
            tokenSource = 'expired';
          } else {
            oauthToken = oauth.accessToken;
            tokenSource = 'credentials';
            const expiresIn = Math.round((expiresAt.getTime() - Date.now()) / 3600000);
            console.log(`\x1b[32m[bridge]\x1b[0m OAuth token loaded from ~/.claude/.credentials.json`);
            console.log(`\x1b[32m[bridge]\x1b[0m Subscription meters enabled (token expires in ~${expiresIn}h)`);
            if (oauth.subscriptionType) {
              console.log(`\x1b[32m[bridge]\x1b[0m Plan: ${oauth.subscriptionType} | Rate limit: ${oauth.rateLimitTier ?? 'unknown'}`);
            }
            console.log();
          }
        } else {
          oauthToken = oauth.accessToken;
          tokenSource = 'credentials';
          console.log(`\x1b[32m[bridge]\x1b[0m OAuth token loaded from ~/.claude/.credentials.json`);
          console.log(`\x1b[32m[bridge]\x1b[0m Subscription meters enabled\n`);
        }
      } else {
        console.log(`\x1b[33m[bridge]\x1b[0m No accessToken in ~/.claude/.credentials.json`);
        console.log(`\x1b[33m[bridge]\x1b[0m Starting without subscription meters\n`);
        tokenSource = 'missing';
      }
    } else {
      console.log(`\x1b[33m[bridge]\x1b[0m ~/.claude/.credentials.json not found`);
      console.log(`\x1b[33m[bridge]\x1b[0m Log in with 'claude' to enable subscription meters`);
      console.log(`\x1b[33m[bridge]\x1b[0m Starting without subscription meters\n`);
      tokenSource = 'no-file';
    }
  } catch (err) {
    console.log(`\x1b[31m[bridge]\x1b[0m Failed to read credentials: ${err.message}`);
    console.log(`\x1b[33m[bridge]\x1b[0m Starting without subscription meters\n`);
    tokenSource = 'error';
  }
} else {
  console.log(`\x1b[32m[bridge]\x1b[0m OAuth token set via CLAUDE_OAUTH_TOKEN env var`);
  console.log(`\x1b[32m[bridge]\x1b[0m Subscription meters enabled\n`);
}

// ── Ensure frontend is built ─────────────────────────────────

const frontendDir = join(process.cwd(), 'packages', 'bridge', 'frontend');
const frontendDist = join(frontendDir, 'dist');

if (process.env.FRONTEND_ENABLED !== 'false' && !existsSync(frontendDist)) {
  console.log(`\x1b[33m[bridge]\x1b[0m Frontend not built — building now...`);

  // Install deps if needed
  if (!existsSync(join(frontendDir, 'node_modules'))) {
    console.log(`\x1b[33m[bridge]\x1b[0m Installing frontend dependencies...`);
    const install = spawn('npm', ['install'], { cwd: frontendDir, stdio: 'inherit', shell: true });
    await new Promise((resolve, reject) => {
      install.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm install failed (exit ${code})`)));
    });
  }

  // Build
  const build = spawn('npm', ['run', 'build'], { cwd: frontendDir, stdio: 'inherit', shell: true });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Frontend build failed (exit ${code})`)));
  });

  console.log(`\x1b[32m[bridge]\x1b[0m Frontend built successfully\n`);
}

// ── Launch bridge ────────────────────────────────────────────

// Merge profile env with process.env (explicit env vars take precedence)
const env = mergeEnv(profileEnv, process.env);
if (oauthToken) {
  env.CLAUDE_OAUTH_TOKEN = oauthToken;
}

const serverEntry = 'packages/bridge/dist/server-entry.js';

let child;
if (secretsMode === 'op-run') {
  // Let 1Password resolve op:// references and inject them as env vars
  child = spawn('op', ['run', '--env-file=.env.tpl', '--', 'node', serverEntry], {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: true,
  });
} else {
  child = spawn('node', [serverEntry], {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

// Forward signals for graceful shutdown
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
