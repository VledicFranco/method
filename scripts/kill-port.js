#!/usr/bin/env node
// Kill the bridge process AND any orphaned Claude Code PTY sessions.
// Cross-platform: works on Windows and Unix.

import { execSync } from 'node:child_process';

const port = process.env.PORT || '3456';

// Step 1: Kill the bridge process
try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
    const pid = out.trim().split(/\s+/).pop();
    if (pid && pid !== '0') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'inherit' });
      console.log(`Bridge stopped (PID ${pid})`);
    } else {
      console.log('Bridge not running');
    }
  } else {
    try {
      execSync(`lsof -ti:${port} | xargs kill 2>/dev/null`, { stdio: 'inherit' });
      console.log('Bridge stopped');
    } catch {
      console.log('Bridge not running');
    }
  }
} catch {
  console.log('Bridge not running');
}

// Step 2: Kill orphaned Claude Code processes spawned by the bridge
try {
  if (process.platform === 'win32') {
    // Find claude.exe processes (PTY sessions spawned by bridge)
    const result = execSync('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH', { encoding: 'utf-8' });
    const lines = result.trim().split('\n').filter(l => l.includes('claude.exe'));
    if (lines.length > 0) {
      execSync('taskkill /F /IM claude.exe', { stdio: 'inherit' });
      console.log(`Killed ${lines.length} orphaned Claude Code process(es)`);
    }
  } else {
    const result = execSync('pgrep -f "claude" 2>/dev/null || true', { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      execSync(`kill ${pids.join(' ')} 2>/dev/null || true`, { stdio: 'inherit' });
      console.log(`Killed ${pids.length} orphaned Claude Code process(es)`);
    }
  }
} catch {
  // No orphaned processes — that's fine
}
