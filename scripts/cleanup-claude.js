#!/usr/bin/env node
// Kill orphaned Claude Code processes that were spawned by the bridge.
// Uses the bridge's PID file to target only bridge-spawned processes.
// Safe to run anytime — will never kill interactive Claude sessions.

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = process.env.PORT || '3456';
const PID_FILE = join(tmpdir(), `method-bridge-${port}.pids`);

// Read PIDs from the bridge's PID file
let childPids;
try {
  const content = readFileSync(PID_FILE, 'utf-8');
  childPids = content.trim().split('\n').map(Number).filter(n => n > 0);
} catch {
  console.log('No PID file found — no bridge-spawned processes to clean up.');
  process.exit(0);
}

if (childPids.length === 0) {
  console.log('PID file is empty — no orphaned processes.');
  try { unlinkSync(PID_FILE); } catch { /* already gone */ }
  process.exit(0);
}

console.log(`Found ${childPids.length} tracked PID(s): ${childPids.join(', ')}`);

let killed = 0;
let alreadyDead = 0;

for (const pid of childPids) {
  try {
    if (process.platform === 'win32') {
      // Verify the process is a bridge child before killing
      try {
        const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8', stdio: 'pipe' });
        if (!info.includes('claude') && !info.includes('cmd.exe') && !info.includes('conhost')) {
          console.log(`  Skipping PID ${pid} — not a bridge child (${info.trim().substring(0, 60)})`);
          continue;
        }
      } catch { continue; /* process already dead */ }
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
    } else {
      // Verify process identity on Linux
      try {
        const comm = execSync(`cat /proc/${pid}/comm 2>/dev/null || ps -p ${pid} -o comm=`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        if (!comm.includes('claude') && !comm.includes('bash') && !comm.includes('sh')) {
          console.log(`  Skipping PID ${pid} — not a bridge child (${comm})`);
          continue;
        }
      } catch { continue; /* process already dead */ }
      execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'pipe' });
    }
    killed++;
    console.log(`  Killed PID ${pid}`);
  } catch {
    alreadyDead++;
    console.log(`  PID ${pid} already dead`);
  }
}

// Clean up the PID file
try { unlinkSync(PID_FILE); } catch { /* already gone */ }

console.log(`Done: ${killed} killed, ${alreadyDead} already dead.`);
