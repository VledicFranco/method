#!/usr/bin/env node
// Kill orphaned Claude Code processes that were spawned by the bridge
// but survived bridge restarts. Safe to run anytime.

import { execSync } from 'node:child_process';

try {
  if (process.platform === 'win32') {
    const result = execSync('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH', { encoding: 'utf-8' });
    const lines = result.trim().split('\n').filter(l => l.includes('claude.exe'));
    if (lines.length === 0) {
      console.log('No Claude Code processes found.');
      process.exit(0);
    }
    console.log(`Found ${lines.length} claude.exe process(es).`);

    // The current process's parent chain includes our own claude.exe — skip it
    const currentPid = process.ppid;
    let killed = 0;

    for (const line of lines) {
      const match = line.match(/"claude\.exe","(\d+)"/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);

      // Skip very large processes (>500MB) — likely active interactive sessions
      const memMatch = line.match(/"([\d,]+)\sK"/);
      if (memMatch) {
        const memKB = parseInt(memMatch[1].replace(/,/g, ''), 10);
        if (memKB > 500_000) {
          console.log(`  Skipping PID ${pid} (${Math.round(memKB / 1024)}MB — likely active session)`);
          continue;
        }
      }

      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        killed++;
        console.log(`  Killed PID ${pid}`);
      } catch {
        // Process may have already exited
      }
    }

    console.log(`Done: ${killed} orphaned process(es) killed, ${lines.length - killed} kept.`);
  } else {
    const result = execSync('pgrep -f "claude" 2>/dev/null || true', { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    if (pids.length === 0) {
      console.log('No Claude Code processes found.');
      process.exit(0);
    }
    console.log(`Found ${pids.length} claude process(es). Killing...`);
    execSync(`kill ${pids.join(' ')} 2>/dev/null || true`, { stdio: 'inherit' });
    console.log('Done.');
  }
} catch (e) {
  console.error('Cleanup error:', e.message);
}
