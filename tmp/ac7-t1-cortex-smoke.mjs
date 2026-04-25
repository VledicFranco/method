#!/usr/bin/env node
/**
 * AC-7 — t1-cortex polyglot smoke harness.
 *
 * Scans the t1-cortex repo with the `typescript` + `scala` profiles and
 * verifies that components from both ecosystems appear in the index.
 *
 * Per PRD 057 AC-7, the scan must surface:
 *   - Scala modules: e.g. modules/api, modules/apps/connectors
 *   - TS packages:   e.g. packages/cortex-app, packages/apps/atlas
 *
 * t1-cortex is treated as read-only — we do NOT write a .fca-index.yaml
 * to its root. Instead we use the createFcaIndex (non-default) factory
 * with a custom in-memory ManifestReader to supply the polyglot
 * sourcePatterns this monorepo needs (it nests packages/apps/<pkg>/src/**
 * two levels deep).
 *
 * Voyage key is FREE TIER — the scan typically takes 2–3 min due to rate
 * limits; that is expected. Run with:
 *
 *   node --env-file=C:/Users/atfm0/Repositories/method-2/.env tmp/ac7-t1-cortex-smoke.mjs
 */

import { mkdir, rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { createFcaIndex } from '../packages/fca-index/dist/factory.js';
import { typescriptProfile, scalaProfile } from '../packages/fca-index/dist/scanner/profiles/index.js';
import { NodeFileSystem } from '../packages/fca-index/dist/cli/node-filesystem.js';
import { VoyageEmbeddingClient } from '../packages/fca-index/dist/index-store/embedding-client.js';
import { SqliteStore } from '../packages/fca-index/dist/index-store/sqlite-store.js';
import { LanceStore } from '../packages/fca-index/dist/index-store/lance-store.js';
import { SqliteLanceIndexStore } from '../packages/fca-index/dist/index-store/index-store.js';

const T1_CORTEX_ROOT = 'C:/Users/atfm0/Repositories/t1-repos/t1-cortex';
// Index dir lives OUTSIDE t1-cortex — keep that repo pristine.
const INDEX_DIR = 'C:/Users/atfm0/Repositories/method-2/.claude/worktrees/agent-a859964cb201eeccb/tmp/ac7-fca-index';

const REQUIRED_SCALA_DIRS = ['modules/api', 'modules/apps/connectors'];
const REQUIRED_TS_DIRS = ['packages/cortex-app', 'packages/apps/atlas'];

async function main() {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('FATAL: VOYAGE_API_KEY not set. Source .env first.');
    process.exit(2);
  }

  // Clean any previous smoke index.
  await rm(INDEX_DIR, { recursive: true, force: true });
  await mkdir(INDEX_DIR, { recursive: true });

  console.error('[ac7] Starting scan of t1-cortex with [typescript, scala] …');
  const t0 = Date.now();

  // Custom manifest reader — supplies polyglot sourcePatterns for t1-cortex
  // without writing a .fca-index.yaml to that repo.
  const customReader = {
    async read(projectRoot) {
      return {
        projectRoot,
        sourcePatterns: [
          'modules/**',                         // Scala — sbt monorepo modules
          'packages/*/src/**',                  // TS — top-level packages
          'packages/apps/*/src/**',             // TS — nested apps
        ],
        excludePatterns: [
          '**/node_modules/**',
          '**/target/**',
          '**/dist/**',
          '**/.fca-index*/**',
          '**/.git/**',
        ],
        requiredParts: ['interface', 'documentation'],
      };
    },
  };

  const fs = new NodeFileSystem();
  const db = new Database(`${INDEX_DIR}/index.db`);
  const sqliteStore = new SqliteStore(db);
  const lanceStore = new LanceStore({ dbPath: `${INDEX_DIR}/vectors`, dimensions: 512 });
  await lanceStore.initialize();
  const store = new SqliteLanceIndexStore(sqliteStore, lanceStore);
  const embedder = new VoyageEmbeddingClient(
    { apiKey, model: 'voyage-3-lite', dimensions: 512 },
    // No-op observability sink (keep stderr free for our progress lines).
    { event: () => {} },
  );

  const fca = createFcaIndex(
    {
      projectRoot: T1_CORTEX_ROOT,
      coverageThreshold: 0.5,
      languages: [typescriptProfile, scalaProfile],
    },
    { fileSystem: fs, embedder, store, manifestReader: customReader },
  );

  const { componentCount } = await fca.scan();
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`[ac7] Scan complete: ${componentCount} components in ${elapsedSec}s`);

  const report = await fca.coverage.getReport({
    projectRoot: T1_CORTEX_ROOT,
    verbose: true,
  });

  const componentsByPath = new Set(report.components.map(c => c.path));
  const componentsList = Array.from(componentsByPath).sort();

  console.error(`[ac7] Total component paths in coverage report: ${componentsByPath.size}`);

  function findMatch(prefix) {
    return componentsList.find(p => p.startsWith(prefix) || p.includes('/' + prefix));
  }

  let failures = 0;
  console.error('\n[ac7] Required Scala dirs:');
  for (const dir of REQUIRED_SCALA_DIRS) {
    const match = findMatch(dir);
    if (match) {
      console.error(`  PASS  ${dir} → ${match}`);
    } else {
      console.error(`  FAIL  ${dir} — not found`);
      failures++;
    }
  }

  console.error('\n[ac7] Required TS dirs:');
  for (const dir of REQUIRED_TS_DIRS) {
    const match = findMatch(dir);
    if (match) {
      console.error(`  PASS  ${dir} → ${match}`);
    } else {
      console.error(`  FAIL  ${dir} — not found`);
      failures++;
    }
  }

  // Summary by L3 detection
  const l3 = report.components.filter(c => c.level === 'L3').length;
  const l2 = report.components.filter(c => c.level === 'L2').length;
  console.error(`\n[ac7] Level breakdown: L3=${l3}, L2=${l2}, total=${report.components.length}`);

  // Sample of detected paths to aid debugging
  console.error('\n[ac7] Sample component paths (first 12):');
  for (const p of componentsList.slice(0, 12)) console.error(`  ${p}`);

  if (failures > 0) {
    console.error(`\n[ac7] FAILED: ${failures}/${REQUIRED_SCALA_DIRS.length + REQUIRED_TS_DIRS.length} required dirs missing`);
    process.exit(1);
  }
  console.error('\n[ac7] PASS — all required Scala and TS dirs present in the index.');
}

main().catch(e => {
  console.error('[ac7] ERROR:', e);
  process.exit(1);
});
