#!/usr/bin/env node
// Run `npm test` for a filtered set of workspaces.
//   --published   only packages with private !== true (publishable)
//   --internal    only packages with private === true + samples/*
//   --all         everything
// Default is --published.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] || '--published';
if (!['--published', '--internal', '--all'].includes(mode)) {
  console.error(`Unknown mode: ${mode}. Use --published | --internal | --all.`);
  process.exit(1);
}

function loadWorkspaces() {
  const out = [];
  for (const subdir of ['packages', 'samples']) {
    const base = join(root, subdir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const pkgPath = join(base, entry, 'package.json');
      if (!existsSync(pkgPath)) continue;
      try {
        const json = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (!json.name) continue;
        const hasTest = !!json.scripts?.test;
        out.push({ name: json.name, group: subdir, private: json.private === true, hasTest });
      } catch {}
    }
  }
  return out;
}

const all = loadWorkspaces();
const filtered = all.filter(w => {
  if (!w.hasTest) return false;
  if (mode === '--all') return true;
  if (mode === '--published') return !w.private;
  if (mode === '--internal') return w.private || w.group === 'samples';
});

if (filtered.length === 0) {
  console.log(`No workspaces match ${mode}. Nothing to run.`);
  process.exit(0);
}

console.log(`Running tests for ${filtered.length} workspace(s) [${mode}]:`);
for (const w of filtered) console.log(`  - ${w.name}`);
console.log('');

const failures = [];
for (const w of filtered) {
  console.log(`\n=== ${w.name} ===`);
  const r = spawnSync('npm', ['test', `--workspace=${w.name}`], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) failures.push(w.name);
}

console.log('\n' + '='.repeat(60));
if (failures.length === 0) {
  console.log(`All ${filtered.length} workspace test suites passed.`);
  process.exit(0);
} else {
  console.error(`${failures.length} workspace test suite(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
