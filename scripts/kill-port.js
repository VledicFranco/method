#!/usr/bin/env node
// Stop the bridge and clean up its child processes.
// Uses graceful shutdown API first, then PID-targeted fallback.
// NEVER kills all claude.exe — only processes tracked by the bridge.

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = process.env.PORT || '3456';
const PID_FILE = join(tmpdir(), `method-bridge-${port}.pids`);

/**
 * Read PIDs from the bridge's PID file.
 * Returns empty array if file doesn't exist.
 */
function readPidFile() {
  try {
    const content = readFileSync(PID_FILE, 'utf-8');
    return content.trim().split('\n').map(Number).filter(n => n > 0);
  } catch {
    return [];
  }
}

function removePidFile() {
  try { unlinkSync(PID_FILE); } catch { /* already gone */ }
}

/**
 * Kill specific PIDs. Returns count of successfully killed processes.
 */
function killPids(pids) {
  let killed = 0;
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'pipe' });
      }
      killed++;
    } catch {
      // Process already dead — that's fine
    }
  }
  return killed;
}

// Step 1: Try graceful shutdown via API
let gracefulSuccess = false;
try {
  execSync(`curl -sf -X POST http://localhost:${port}/shutdown`, {
    stdio: 'pipe',
    timeout: 3000,
  });
  console.log('Graceful shutdown requested — waiting for bridge to stop...');

  // Wait up to 5s for the bridge to exit
  for (let i = 0; i < 10; i++) {
    try {
      execSync(`curl -sf http://localhost:${port}/health`, { stdio: 'pipe', timeout: 1000 });
      // Still alive — wait
      execSync(process.platform === 'win32' ? 'timeout /t 1 /nobreak >nul' : 'sleep 0.5', { stdio: 'pipe' });
    } catch {
      // Health check failed — bridge is down
      gracefulSuccess = true;
      console.log('Bridge stopped gracefully');
      break;
    }
  }

  if (!gracefulSuccess) {
    console.log('Graceful shutdown timed out — force-killing bridge process');
  }
} catch {
  // Bridge not reachable — may not be running, or already dead
}

// Step 2: Force-kill bridge process if graceful shutdown failed
if (!gracefulSuccess) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
      const pid = out.trim().split(/\s+/).pop();
      if (pid && pid !== '0') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'inherit' });
        console.log(`Bridge force-stopped (PID ${pid})`);
      } else {
        console.log('Bridge not running');
      }
    } else {
      try {
        execSync(`lsof -ti:${port} | xargs kill 2>/dev/null`, { stdio: 'inherit' });
        console.log('Bridge force-stopped');
      } catch {
        console.log('Bridge not running');
      }
    }
  } catch {
    console.log('Bridge not running');
  }
}

// Step 3: Kill orphaned child processes using PID file (targeted, not nuclear)
const childPids = readPidFile();
if (childPids.length > 0) {
  const killed = killPids(childPids);
  if (killed > 0) {
    console.log(`Killed ${killed} orphaned child process(es) (PIDs: ${childPids.join(', ')})`);
  }
}
removePidFile();
