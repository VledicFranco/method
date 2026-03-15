#!/usr/bin/env node
// Kill the process listening on the bridge port (default 3456).
// Cross-platform: works on Windows and Unix.

import { execSync } from 'node:child_process';

const port = process.env.PORT || '3456';

try {
  if (process.platform === 'win32') {
    // Windows: find PID via netstat, kill via taskkill
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
    const pid = out.trim().split(/\s+/).pop();
    if (pid && pid !== '0') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'inherit' });
      console.log(`Bridge stopped (PID ${pid})`);
    } else {
      console.log('Bridge not running');
    }
  } else {
    // Unix: fuser or lsof
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
