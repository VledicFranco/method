#!/usr/bin/env node
// Bridge launcher — auto-loads CLAUDE_OAUTH_TOKEN from Claude Code credentials
// and passes it to the bridge process.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

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

// ── Launch bridge ────────────────────────────────────────────

const env = { ...process.env };
if (oauthToken) {
  env.CLAUDE_OAUTH_TOKEN = oauthToken;
}

const child = spawn('node', ['packages/bridge/dist/index.js'], {
  env,
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

// Forward signals for graceful shutdown
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
