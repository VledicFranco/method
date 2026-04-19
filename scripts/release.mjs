#!/usr/bin/env node
// Release script: bumps every publishable package to a new version, updates
// CHANGELOG.md, commits, tags, pushes, and creates a GitHub release.
// The Release GitHub Actions workflow then publishes to npm with provenance.

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: 'pipe', ...opts }).trim();
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// --- Validate arguments ---
const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.log('Usage: node scripts/release.mjs <patch|minor|major>');
  process.exit(1);
}

// --- Validate environment ---
try {
  run('git rev-parse --is-inside-work-tree');
} catch {
  fail('Not inside a git repository.');
}

const branch = run('git rev-parse --abbrev-ref HEAD');
if (branch !== 'master') {
  fail(`Must be on the 'master' branch (currently on '${branch}').`);
}

const status = run('git status --porcelain');
if (status.length > 0) {
  fail('Working tree is not clean. Commit or stash your changes first.');
}

try {
  run('gh --version');
} catch {
  fail('GitHub CLI (gh) is not installed or not in PATH.');
}

// --- Discover publishable packages ---
// A package is publishable if it lives under packages/ AND `private !== true`.
const packagesDir = join(root, 'packages');
const PUBLISHABLE = [];
for (const entry of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, entry, 'package.json');
  try {
    const p = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (p.private === true) continue;
    if (!p.name) continue;
    PUBLISHABLE.push({ dir: entry, name: p.name, path: pkgPath, json: p });
  } catch {
    // no package.json — skip
  }
}

if (PUBLISHABLE.length === 0) fail('No publishable packages found.');

// --- Read current version (use first publishable as the source of truth) ---
const currentVersion = PUBLISHABLE[0].json.version;
if (!currentVersion) fail(`Could not read current version from ${PUBLISHABLE[0].path}.`);

// All publishable packages must share the same version.
for (const pkg of PUBLISHABLE) {
  if (pkg.json.version !== currentVersion) {
    fail(`Version drift: ${pkg.name} is ${pkg.json.version}, expected ${currentVersion}. Run \`node scripts/release-resync.mjs\` (TODO) or fix manually.`);
  }
}

// --- Compute next version ---
const [major, minor, patch] = currentVersion.split('.').map(Number);
let nextVersion;
switch (bump) {
  case 'major': nextVersion = `${major + 1}.0.0`; break;
  case 'minor': nextVersion = `${major}.${minor + 1}.0`; break;
  case 'patch': nextVersion = `${major}.${minor}.${patch + 1}`; break;
}

console.log(`Bumping ${PUBLISHABLE.length} packages: ${currentVersion} → ${nextVersion} (${bump})\n`);

// --- Update all publishable package.json files ---
for (const pkg of PUBLISHABLE) {
  pkg.json.version = nextVersion;
  writeFileSync(pkg.path, JSON.stringify(pkg.json, null, 2) + '\n');
  console.log(`  updated  packages/${pkg.dir}/package.json`);
}

// --- Update CHANGELOG.md ---
const changelogPath = join(root, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');
const today = new Date().toISOString().split('T')[0];
const newSection = `## [Unreleased]\n\n## [${nextVersion}] - ${today}`;
if (!changelog.includes('## [Unreleased]')) {
  fail('CHANGELOG.md is missing the `## [Unreleased]` section.');
}
const updatedChangelog = changelog.replace('## [Unreleased]', newSection);
writeFileSync(changelogPath, updatedChangelog);
console.log('  updated  CHANGELOG.md');

// --- Git commit and tag ---
const tag = `v${nextVersion}`;
run('git add -A');
run(`git commit -m "chore: release ${tag}"`);
console.log(`  commit   chore: release ${tag}`);

run(`git tag ${tag}`);
console.log(`  tag      ${tag}`);

// --- Push ---
run('git push');
run('git push --tags');
console.log('  pushed   commit + tag');

// --- Create GitHub release ---
run(`gh release create ${tag} --title "${tag}" --generate-notes`);
console.log(`  release  ${tag}`);

console.log(`\nRelease ${tag} dispatched. Watch the workflow: https://github.com/VledicFranco/method/actions`);
