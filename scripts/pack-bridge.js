#!/usr/bin/env node
// Packaging orchestrator for the method-bridge portable distribution.
// Produces a self-contained tarball that can be installed on any machine
// with Node.js 22+ without cloning the full monorepo.
//
// Steps:
//   1. Run npm run build (all packages)
//   2. Build frontend if packages/bridge/frontend/ exists
//   3. Bundle server-entry.js via esbuild (all workspace deps inlined)
//   4. Bundle MCP server via esbuild
//   5. Generate .mcp.json template
//   6. Assemble tarball contents
//   7. Output: method-bridge-{version}.tgz
//
// Usage: node scripts/pack-bridge.js
//
// Prerequisites:
//   - esbuild must be installed (npm install esbuild --save-dev)
//   - All workspace packages must be buildable

'use strict';

const { execSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } = require('node:fs');
const { join } = require('node:path');

// ── Constants ──────────────────────────────────────────────────

const ROOT = join(__dirname, '..');
const STAGE_DIR = join(ROOT, 'dist-pack');
const DIST_BUNDLE = join(STAGE_DIR, 'dist-bundle');

const BRIDGE_ENTRY = join(ROOT, 'packages', 'bridge', 'dist', 'server-entry.js');
const MCP_ENTRY = join(ROOT, 'packages', 'mcp', 'dist', 'index.js');
const FRONTEND_DIR = join(ROOT, 'packages', 'bridge', 'frontend');
const FRONTEND_DIST = join(FRONTEND_DIR, 'dist');
const BIN_DIR = join(ROOT, 'packages', 'bridge', 'bin');
const ENV_TPL = join(ROOT, '.env.tpl');
const INSTANCES_DIR = join(ROOT, '.method', 'instances');

// ── Helpers ────────────────────────────────────────────────────

/**
 * Print a colored step header.
 * @param {number} step
 * @param {string} message
 */
function logStep(step, message) {
  console.log(`\n\x1b[36m[pack ${step}/7]\x1b[0m ${message}`);
}

/**
 * Run a shell command with inherited stdio. Exit on failure.
 * @param {string} cmd
 * @param {string} errorMsg
 * @param {object} [opts]
 */
function run(cmd, errorMsg, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...opts });
  } catch (err) {
    console.error(`\x1b[31m[pack]\x1b[0m ${errorMsg}`);
    console.error(`\x1b[31m[pack]\x1b[0m Command failed: ${cmd}`);
    process.exit(1);
  }
}

/**
 * Read the version from root package.json.
 * @returns {string}
 */
function getVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version || '0.0.0';
}

/**
 * Check that esbuild is available.
 */
function checkEsbuild() {
  try {
    require.resolve('esbuild');
  } catch {
    console.error(
      `\x1b[31m[pack]\x1b[0m esbuild is not installed.\n` +
      `Install it with: npm install esbuild --save-dev\n` +
      `Then re-run: node scripts/pack-bridge.js`
    );
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────

function main() {
  console.log('\x1b[1m\x1b[36m=== Method Bridge Packaging ===\x1b[0m');

  // Pre-flight: check esbuild
  checkEsbuild();

  const version = getVersion();
  console.log(`Version: ${version}`);

  // Clean staging directory
  if (existsSync(STAGE_DIR)) {
    rmSync(STAGE_DIR, { recursive: true, force: true });
  }
  mkdirSync(DIST_BUNDLE, { recursive: true });

  // ── Step 1: Build all packages ─────────────────────────────

  logStep(1, 'Building all packages (npm run build)...');
  run('npm run build', 'TypeScript build failed. Fix build errors before packaging.');

  // Verify build outputs exist
  if (!existsSync(BRIDGE_ENTRY)) {
    console.error(`\x1b[31m[pack]\x1b[0m Bridge entry not found after build: ${BRIDGE_ENTRY}`);
    process.exit(1);
  }
  if (!existsSync(MCP_ENTRY)) {
    console.error(`\x1b[31m[pack]\x1b[0m MCP entry not found after build: ${MCP_ENTRY}`);
    process.exit(1);
  }

  // ── Step 2: Build frontend ─────────────────────────────────

  logStep(2, 'Building frontend...');
  if (existsSync(FRONTEND_DIR)) {
    // Install deps if needed
    if (!existsSync(join(FRONTEND_DIR, 'node_modules'))) {
      console.log('  Installing frontend dependencies...');
      run('npm install', 'Frontend dependency install failed.', { cwd: FRONTEND_DIR });
    }
    run('npm run build', 'Frontend build failed.', { cwd: FRONTEND_DIR });
    console.log('  Frontend built successfully.');
  } else {
    console.log('  No frontend directory found — skipping.');
  }

  // ── Step 3: Bundle bridge via esbuild ──────────────────────

  logStep(3, 'Bundling bridge server (esbuild)...');

  const esbuild = require('esbuild');

  try {
    const bridgeResult = esbuild.buildSync({
      entryPoints: [BRIDGE_ENTRY],
      bundle: true,
      platform: 'node',
      target: 'node22',
      outfile: join(DIST_BUNDLE, 'server-entry.js'),
      external: ['better-sqlite3'],
      format: 'cjs',
      sourcemap: false,
      // Log level info to see bundle stats
      logLevel: 'info',
    });

    if (bridgeResult.errors.length > 0) {
      console.error(`\x1b[31m[pack]\x1b[0m esbuild reported errors for bridge bundle:`);
      for (const err of bridgeResult.errors) {
        console.error(`  ${err.text}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m[pack]\x1b[0m Bridge bundling failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`  Bridge bundled: dist-bundle/server-entry.js`);

  // ── Step 4: Bundle MCP server via esbuild ──────────────────

  logStep(4, 'Bundling MCP server (esbuild)...');

  try {
    const mcpResult = esbuild.buildSync({
      entryPoints: [MCP_ENTRY],
      bundle: true,
      platform: 'node',
      target: 'node22',
      outfile: join(DIST_BUNDLE, 'mcp-server.js'),
      format: 'cjs',
      sourcemap: false,
      logLevel: 'info',
    });

    if (mcpResult.errors.length > 0) {
      console.error(`\x1b[31m[pack]\x1b[0m esbuild reported errors for MCP bundle:`);
      for (const err of mcpResult.errors) {
        console.error(`  ${err.text}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m[pack]\x1b[0m MCP server bundling failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`  MCP server bundled: dist-bundle/mcp-server.js`);

  // ── Step 5: Generate .mcp.json template ────────────────────

  logStep(5, 'Generating .mcp.json template...');

  const mcpConfig = {
    mcpServers: {
      method: {
        command: 'node',
        args: ['dist-bundle/mcp-server.js'],
        cwd: '.',
      },
    },
  };

  writeFileSync(
    join(STAGE_DIR, '.mcp.json'),
    JSON.stringify(mcpConfig, null, 2) + '\n',
    'utf-8'
  );
  console.log('  Generated .mcp.json template.');

  // ── Step 6: Assemble tarball contents ──────────────────────

  logStep(6, 'Assembling tarball contents...');

  // Copy frontend dist
  if (existsSync(FRONTEND_DIST)) {
    const stageFrontend = join(STAGE_DIR, 'frontend', 'dist');
    cpSync(FRONTEND_DIST, stageFrontend, { recursive: true });
    console.log('  Copied: frontend/dist/');
  } else {
    console.log('  Warning: frontend/dist/ not found — tarball will lack frontend assets.');
  }

  // Copy bin/
  if (existsSync(BIN_DIR)) {
    cpSync(BIN_DIR, join(STAGE_DIR, 'bin'), { recursive: true });
    console.log('  Copied: bin/');
  }

  // Copy .env.tpl
  if (existsSync(ENV_TPL)) {
    cpSync(ENV_TPL, join(STAGE_DIR, '.env.tpl'));
    console.log('  Copied: .env.tpl');
  } else {
    console.log('  Warning: .env.tpl not found — tarball will lack secrets template.');
  }

  // Copy .method/instances/ templates
  if (existsSync(INSTANCES_DIR)) {
    cpSync(INSTANCES_DIR, join(STAGE_DIR, '.method', 'instances'), { recursive: true });
    console.log('  Copied: .method/instances/');
  }

  // Generate a minimal package.json for the tarball
  const tarballPkg = {
    name: 'method-bridge',
    version: version,
    description: 'Method Bridge — runtime for executable formal methodologies',
    bin: {
      'method-bridge': 'bin/method-bridge.js',
    },
    files: [
      'dist-bundle/',
      'frontend/',
      'bin/',
      '.env.tpl',
      '.mcp.json',
      '.method/',
    ],
    engines: {
      node: '>=22.0.0',
    },
  };

  writeFileSync(
    join(STAGE_DIR, 'package.json'),
    JSON.stringify(tarballPkg, null, 2) + '\n',
    'utf-8'
  );
  console.log('  Generated: package.json');

  // ── Step 7: Create tarball ─────────────────────────────────

  logStep(7, `Creating tarball: method-bridge-${version}.tgz...`);

  const tarballName = `method-bridge-${version}.tgz`;
  const tarballPath = join(ROOT, tarballName);

  // Use npm pack from the staging directory
  run(`npm pack --pack-destination "${ROOT}"`, 'Failed to create tarball.', { cwd: STAGE_DIR });

  // npm pack creates a file named from the package name and version
  // Rename if npm produced a different filename
  const npmPackName = `method-bridge-${version}.tgz`;
  const npmPackPath = join(ROOT, npmPackName);

  if (existsSync(npmPackPath)) {
    console.log(`\n\x1b[32m[pack]\x1b[0m Success! Tarball created: ${npmPackName}`);
    console.log(`\x1b[32m[pack]\x1b[0m Size: ${(readFileSync(npmPackPath).length / 1024).toFixed(1)} KB`);
  } else {
    // npm pack may use a different naming convention — list what it created
    console.log(`\x1b[33m[pack]\x1b[0m Tarball created in project root (check for .tgz files).`);
  }

  // Clean up staging directory
  rmSync(STAGE_DIR, { recursive: true, force: true });

  console.log(`\x1b[32m[pack]\x1b[0m Packaging complete.\n`);
}

main();
