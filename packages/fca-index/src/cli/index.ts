#!/usr/bin/env node
/**
 * fca-index CLI — index and query FCA-compliant projects.
 *
 * Usage:
 *   fca-index scan <projectRoot> [--verbose]
 *   fca-index query <projectRoot> <queryString> [--topK=5] [--parts=port,interface]
 *   fca-index coverage <projectRoot> [--verbose]
 *
 * Environment variables:
 *   VOYAGE_API_KEY — required for scan and query commands (embedding API)
 */

import { resolve } from 'node:path';
import { NodeFileSystem } from './node-filesystem.js';
import { DefaultManifestReader } from './manifest-reader.js';
import { Indexer } from './indexer.js';
import { runScanCommand } from './commands/scan.js';
import { runQueryCommand } from './commands/query.js';
import { runCoverageCommand } from './commands/coverage.js';
import type { FcaPart } from '../ports/context-query.js';

// ── Arg parsing helpers ──────────────────────────────────────────────────────

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getOption(args: string[], prefix: string): string | undefined {
  const match = args.find((a) => a.startsWith(prefix + '='));
  return match ? match.slice(prefix.length + 1) : undefined;
}

function fatal(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

// ── Store builder helper ─────────────────────────────────────────────────────

async function buildStore(projectRoot: string, indexDir: string, dimensions: number) {
  const resolvedIndexDir = resolve(projectRoot, indexDir);

  const { mkdir } = await import('node:fs/promises');
  await mkdir(resolvedIndexDir, { recursive: true });

  const { SqliteStore } = await import('../index-store/sqlite-store.js');
  const { LanceStore } = await import('../index-store/lance-store.js');
  const { SqliteLanceIndexStore } = await import('../index-store/index-store.js');
  const BetterSqlite3 = (await import('better-sqlite3')).default;

  const db = new BetterSqlite3(resolve(resolvedIndexDir, 'index.db'));
  const sqliteStore = new SqliteStore(db);
  const lanceStore = new LanceStore({
    dbPath: resolve(resolvedIndexDir, 'vectors'),
    dimensions,
  });
  await lanceStore.initialize();

  return new SqliteLanceIndexStore(sqliteStore, lanceStore);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  const fs = new NodeFileSystem();
  const manifestReader = new DefaultManifestReader(fs);

  switch (subcommand) {
    case 'scan': {
      const projectRoot = args[1] ? resolve(args[1]) : process.cwd();
      const verbose = hasFlag(args, '--verbose');

      const apiKey = process.env['VOYAGE_API_KEY'];
      if (!apiKey) fatal('VOYAGE_API_KEY environment variable is required for scan.');

      const { VoyageEmbeddingClient } = await import('../index-store/embedding-client.js');
      const embedder = new VoyageEmbeddingClient({ apiKey });

      const scanConfig = await manifestReader.read(projectRoot);
      const indexDir = scanConfig.indexDir ?? '.fca-index';
      const dimensions = scanConfig.embeddingDimensions ?? 512;

      const store = await buildStore(projectRoot, indexDir, dimensions);

      const { FcaDetector } = await import('../scanner/fca-detector.js');
      const { CoverageScorer } = await import('../scanner/coverage-scorer.js');
      const { ProjectScanner } = await import('../scanner/project-scanner.js');

      const scanner = new ProjectScanner(fs, new FcaDetector(fs), new CoverageScorer());
      const indexer = new Indexer(scanner, embedder, store, manifestReader);

      await runScanCommand(indexer, { projectRoot, verbose });
      break;
    }

    case 'query': {
      const projectRoot = args[1] ? resolve(args[1]) : process.cwd();
      const queryString = args[2];
      if (!queryString) fatal('Usage: fca-index query <projectRoot> <queryString>');

      const topKRaw = getOption(args, '--topK');
      const topK = topKRaw ? parseInt(topKRaw, 10) : 5;

      const partsRaw = getOption(args, '--parts');
      const parts = partsRaw ? (partsRaw.split(',') as FcaPart[]) : undefined;

      const apiKey = process.env['VOYAGE_API_KEY'];
      if (!apiKey) fatal('VOYAGE_API_KEY environment variable is required for query.');

      const { VoyageEmbeddingClient } = await import('../index-store/embedding-client.js');
      const embedder = new VoyageEmbeddingClient({ apiKey });

      const scanConfig = await manifestReader.read(projectRoot);
      const indexDir = scanConfig.indexDir ?? '.fca-index';
      const dimensions = scanConfig.embeddingDimensions ?? 512;

      const store = await buildStore(projectRoot, indexDir, dimensions);

      const { QueryEngine } = await import('../query/query-engine.js');
      const queryEngine = new QueryEngine(store, embedder, fs, {
        projectRoot,
        coverageThreshold: scanConfig.coverageThreshold,
      });

      await runQueryCommand(queryEngine, { query: queryString, topK, parts });
      break;
    }

    case 'coverage': {
      const projectRoot = args[1] ? resolve(args[1]) : process.cwd();
      const verbose = hasFlag(args, '--verbose');

      const scanConfig = await manifestReader.read(projectRoot);
      const indexDir = scanConfig.indexDir ?? '.fca-index';
      const dimensions = scanConfig.embeddingDimensions ?? 512;

      const store = await buildStore(projectRoot, indexDir, dimensions);

      const { CoverageEngine } = await import('../coverage/coverage-engine.js');
      const coverageEngine = new CoverageEngine(store, {
        threshold: scanConfig.coverageThreshold,
      });

      await runCoverageCommand(coverageEngine, { projectRoot, verbose });
      break;
    }

    default:
      process.stderr.write(
        'Usage:\n' +
          '  fca-index scan <projectRoot> [--verbose]\n' +
          '  fca-index query <projectRoot> <queryString> [--topK=5] [--parts=port,interface]\n' +
          '  fca-index coverage <projectRoot> [--verbose]\n',
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.message : err) + '\n');
  process.exit(1);
});
