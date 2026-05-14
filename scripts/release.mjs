#!/usr/bin/env node
// Release script. Two modes:
//
//   1. LOCKSTEP (default):
//        node scripts/release.mjs <patch|minor|major>
//      Bumps every publishable package to a shared next version. Requires
//      all package versions to already match (errors on drift). Creates
//      one tag (`v<version>`) and one GitHub release.
//
//   2. PER-PACKAGE:
//        node scripts/release.mjs <patch|minor|major> --package <name>
//      Bumps a SINGLE publishable package's own current version. Tolerates
//      drift in OTHER packages. Creates a per-package tag (`<flat>-v<version>`
//      where `<flat>` is the package name with `@` stripped and `/` → `-`).
//      The Release workflow inspects the tag shape and publishes only the
//      named package. Useful when one package needs a fix but the rest of
//      the monorepo is mid-stream (e.g., `@methodts/runtime` patch while
//      `@methodts/fca-index` is mid-rename to `@fractal-co-design/fca-index`).
//
// Both modes commit the version bump + a CHANGELOG entry, push the commit
// and tag, then create a GitHub release. The `Release` Actions workflow
// (.github/workflows/release.yml) is triggered by the release and handles
// the actual `npm publish --provenance`.

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

// --- Parse arguments ---
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/release.mjs <patch|minor|major> [--package <name>]';
if (args.length === 0) {
  console.log(usage);
  process.exit(1);
}
const bump = args[0];
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.log(usage);
  process.exit(1);
}
let targetPackageName = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--package') {
    if (i + 1 >= args.length) fail('--package requires a package name (e.g., @methodts/runtime).');
    targetPackageName = args[i + 1];
    i++;
  } else {
    fail(`Unknown argument: ${args[i]}\n${usage}`);
  }
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

// Helper: package name → flat tag prefix (strip `@`, `/` → `-`).
const flatNameOf = (name) => name.replace(/^@/, '').replace(/\//g, '-');

// --- Compute next version + selected target(s) ---
function nextVersionOf(current) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`unreachable bump=${bump}`);
}

let targetPackages;          // array of PUBLISHABLE entries getting bumped
let nextVersion;             // single string when lockstep, per-pkg map when per-package
let tag;                     // primary tag identifier
let releaseTitle;            // human-readable
let changelogHeading;        // entry inserted under ## [Unreleased]

if (targetPackageName) {
  // ─── PER-PACKAGE MODE ───────────────────────────────────────────────
  const pkg = PUBLISHABLE.find(p => p.name === targetPackageName);
  if (!pkg) {
    const available = PUBLISHABLE.map(p => p.name).join(', ');
    fail(`Package '${targetPackageName}' not found among publishable packages: ${available}`);
  }
  const current = pkg.json.version;
  if (!current) fail(`Could not read current version from ${pkg.path}.`);
  const next = nextVersionOf(current);

  targetPackages = [pkg];
  nextVersion = next;
  tag = `${flatNameOf(pkg.name)}-v${next}`;
  releaseTitle = `${pkg.name}@${next}`;
  changelogHeading = `## [${pkg.name}@${next}] - ${new Date().toISOString().split('T')[0]}`;

  console.log(`Per-package release: bumping ${pkg.name} ${current} → ${next} (${bump})\n`);
} else {
  // ─── LOCKSTEP MODE ──────────────────────────────────────────────────
  const currentVersion = PUBLISHABLE[0].json.version;
  if (!currentVersion) fail(`Could not read current version from ${PUBLISHABLE[0].path}.`);

  for (const pkg of PUBLISHABLE) {
    if (pkg.json.version !== currentVersion) {
      fail(
        `Version drift: ${pkg.name} is ${pkg.json.version}, expected ${currentVersion}.\n`
        + `  Options:\n`
        + `    (a) Re-align all publishable package.json versions manually, OR\n`
        + `    (b) Use per-package mode for the single bump:\n`
        + `        node scripts/release.mjs ${bump} --package <name>`
      );
    }
  }

  const next = nextVersionOf(currentVersion);
  targetPackages = PUBLISHABLE;
  nextVersion = next;
  tag = `v${next}`;
  releaseTitle = tag;
  changelogHeading = `## [${next}] - ${new Date().toISOString().split('T')[0]}`;

  console.log(`Lockstep release: bumping ${PUBLISHABLE.length} packages ${currentVersion} → ${next} (${bump})\n`);
}

// --- Update target package.json files ---
for (const pkg of targetPackages) {
  pkg.json.version = nextVersion;
  writeFileSync(pkg.path, JSON.stringify(pkg.json, null, 2) + '\n');
  console.log(`  updated  packages/${pkg.dir}/package.json`);
}

// --- Update CHANGELOG.md ---
const changelogPath = join(root, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');
if (!changelog.includes('## [Unreleased]')) {
  fail('CHANGELOG.md is missing the `## [Unreleased]` section.');
}
const updatedChangelog = changelog.replace(
  '## [Unreleased]',
  `## [Unreleased]\n\n${changelogHeading}`,
);
writeFileSync(changelogPath, updatedChangelog);
console.log('  updated  CHANGELOG.md');

// --- Git commit and tag ---
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
run(`gh release create ${tag} --title "${releaseTitle}" --generate-notes`);
console.log(`  release  ${tag}`);

console.log(`\nRelease ${tag} dispatched. Watch the workflow: https://github.com/VledicFranco/method/actions`);
