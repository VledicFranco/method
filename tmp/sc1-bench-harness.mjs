#!/usr/bin/env node
/**
 * SC-1 reproduction harness.
 *
 * Runs the 5 benchmark queries from PRD 053 SC-1 revision section.
 * Renders results in the same format that @method/mcp emits to the agent.
 * Counts characters and estimates tokens (chars / 4).
 *
 * Usage: VOYAGE_API_KEY=... node tmp/sc1-bench-harness.mjs
 */

// Use the CLI's exact wiring: index.db + vectors/ (createDefaultFcaIndex uses
// different filenames and would not see the existing scan).
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import BetterSqlite3 from 'better-sqlite3';
import { NodeFileSystem } from '../packages/fca-index/dist/cli/node-filesystem.js';
import { DefaultManifestReader } from '../packages/fca-index/dist/cli/manifest-reader.js';
import { VoyageEmbeddingClient } from '../packages/fca-index/dist/index-store/embedding-client.js';
import { SqliteStore } from '../packages/fca-index/dist/index-store/sqlite-store.js';
import { LanceStore } from '../packages/fca-index/dist/index-store/lance-store.js';
import { SqliteLanceIndexStore } from '../packages/fca-index/dist/index-store/index-store.js';
import { QueryEngine } from '../packages/fca-index/dist/query/query-engine.js';
import { ComponentDetailEngine } from '../packages/fca-index/dist/query/component-detail-engine.js';

const QUERIES = [
  { id: 'Q1', q: 'event bus implementation',           grepBaseline: 13200 },
  { id: 'Q2', q: 'session lifecycle management',       grepBaseline:  8000 },
  { id: 'Q3', q: 'strategy pipeline execution',        grepBaseline:  9000 },
  { id: 'Q4', q: 'FCA architecture gate tests',        grepBaseline:   300 },
  { id: 'Q5', q: 'methodology session persistence',    grepBaseline:  7000 },
];

// ── MCP formatter (copied verbatim from packages/mcp/src/context-tools.ts) ──
// Per-rank render shape (PRD 053 SC-1 — council 2026-04-12):
// top-1 multi-line | prefix at 500 per part / 1800 total; rest single-line > at 120.
const TOP_EXCERPT_RENDER_LIMIT = 350;
const TOP_TOTAL_RENDER_LIMIT = 1400;
const REST_EXCERPT_RENDER_LIMIT = 120;

function formatContextQueryResult(result, query) {
  const lines = [
    `[mode: ${result.mode}]`,
    `[${result.results.length} results for "${query}"]`,
    '',
  ];
  for (let i = 0; i < result.results.length; i++) {
    const c = result.results[i];
    const isTop = i === 0;
    lines.push(
      `${i + 1}. ${c.path} (${c.level}) — relevance: ${c.relevanceScore.toFixed(2)}, coverage: ${c.coverageScore.toFixed(2)}`,
    );

    let topUsed = 0;
    for (const p of c.parts) {
      lines.push(`   ${p.part}: ${p.filePath}`);
      if (!p.excerpt) continue;

      if (isTop) {
        const remaining = TOP_TOTAL_RENDER_LIMIT - topUsed;
        if (remaining <= 0) continue;
        const limit = Math.min(TOP_EXCERPT_RENDER_LIMIT, remaining);
        const excerpt = p.excerpt.slice(0, limit);
        const indented = excerpt
          .split('\n')
          .map((l) => `     | ${l}`)
          .join('\n');
        lines.push(indented);
        topUsed += excerpt.length;
      } else {
        const excerpt = p.excerpt.slice(0, REST_EXCERPT_RENDER_LIMIT).replace(/\n/g, ' ');
        lines.push(`     > ${excerpt}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatComponentDetail(detail) {
  const lines = [
    `path: ${detail.path}`,
    `level: ${detail.level}`,
    `indexedAt: ${detail.indexedAt}`,
    '',
    'parts:',
  ];
  for (const p of detail.parts) {
    lines.push(`  ${p.part}: ${p.filePath}`);
    if (p.excerpt) {
      const excerpt = p.excerpt.slice(0, 300).replace(/\n/g, '\n    ');
      lines.push(`    > ${excerpt}`);
    }
  }
  if (detail.docText) {
    lines.push('');
    lines.push('docText:');
    const truncated =
      detail.docText.length > 2000
        ? detail.docText.slice(0, 2000) + '\n... (truncated)'
        : detail.docText;
    lines.push(truncated);
  }
  return lines.join('\n').trimEnd();
}

const tokens = (s) => Math.ceil(s.length / 4);

// ── Main ────────────────────────────────────────────────────────────────────

const projectRoot = resolve(process.cwd());
const apiKey = process.env.VOYAGE_API_KEY;
if (!apiKey) {
  console.error('VOYAGE_API_KEY missing');
  process.exit(1);
}

const fs = new NodeFileSystem();
const manifestReader = new DefaultManifestReader(fs);
const scanConfig = await manifestReader.read(projectRoot);
const indexDir = scanConfig.indexDir ?? '.fca-index';
const dimensions = scanConfig.embeddingDimensions ?? 512;

const resolvedIndexDir = resolve(projectRoot, indexDir);
await mkdir(resolvedIndexDir, { recursive: true });
const db = new BetterSqlite3(resolve(resolvedIndexDir, 'index.db'));
const sqliteStore = new SqliteStore(db);
const lanceStore = new LanceStore({
  dbPath: resolve(resolvedIndexDir, 'vectors'),
  dimensions,
});
await lanceStore.initialize();
const store = new SqliteLanceIndexStore(sqliteStore, lanceStore);
const embedder = new VoyageEmbeddingClient({ apiKey });
const queryEngine = new QueryEngine(store, embedder, fs, {
  projectRoot,
  coverageThreshold: scanConfig.coverageThreshold,
});
const detailEngine = new ComponentDetailEngine(store);

const fca = { query: queryEngine, detail: detailEngine };

const allRows = [];
let totalQueryTokens = 0;
let totalDetailTokens = 0;

for (const { id, q, grepBaseline } of QUERIES) {
  const t0 = Date.now();
  const result = await fca.query.query({ query: q, topK: 5 });
  const elapsedMs = Date.now() - t0;

  const rendered = formatContextQueryResult(result, q);
  const queryTokens = tokens(rendered);

  // Also fetch detail for the top-1 result (the next step a focused agent takes)
  let detailTokens = 0;
  let detailRendered = '';
  if (result.results.length > 0) {
    const top = result.results[0];
    const detail = await fca.detail.getDetail({ path: top.path, projectRoot });
    detailRendered = formatComponentDetail(detail);
    detailTokens = tokens(detailRendered);
  }

  totalQueryTokens += queryTokens;
  totalDetailTokens += detailTokens;

  console.log('━'.repeat(80));
  console.log(`${id}: "${q}"  (${elapsedMs}ms)`);
  console.log(`  query result tokens : ${queryTokens.toString().padStart(5)}  (${rendered.length} chars)`);
  console.log(`  +top-1 detail tokens: ${detailTokens.toString().padStart(5)}  (${detailRendered.length} chars)`);
  console.log(`  combined            : ${(queryTokens + detailTokens).toString().padStart(5)}`);
  console.log(`  grep baseline       : ${grepBaseline.toString().padStart(5)}`);
  console.log(`  ratio (query only)  : ${((queryTokens / grepBaseline) * 100).toFixed(0)}%`);
  console.log(`  ratio (q+detail)    : ${(((queryTokens + detailTokens) / grepBaseline) * 100).toFixed(0)}%`);
  console.log();
  console.log('--- query rendering ---');
  console.log(rendered);
  console.log();
  console.log('--- top-1 detail rendering ---');
  console.log(detailRendered);
  console.log();

  allRows.push({
    id, q, grepBaseline,
    queryTokens, detailTokens,
    queryChars: rendered.length,
    detailChars: detailRendered.length,
    elapsedMs,
  });
}

const totalGrep = QUERIES.reduce((s, q) => s + q.grepBaseline, 0);

console.log('═'.repeat(80));
console.log('TOTALS');
console.log('═'.repeat(80));
console.log(`grep baseline total       : ${totalGrep}`);
console.log(`query-only total          : ${totalQueryTokens}  (${((totalQueryTokens / totalGrep) * 100).toFixed(0)}%)`);
console.log(`query+top-1 detail total  : ${totalQueryTokens + totalDetailTokens}  (${(((totalQueryTokens + totalDetailTokens) / totalGrep) * 100).toFixed(0)}%)`);
console.log();
console.log('Per-query summary (tokens):');
console.log('id  query                                  grep   q-only  +det   ratio');
for (const r of allRows) {
  const ratio = ((r.queryTokens / r.grepBaseline) * 100).toFixed(0).padStart(4);
  console.log(
    `${r.id}  ${r.q.padEnd(38)} ${r.grepBaseline.toString().padStart(5)}   ${r.queryTokens.toString().padStart(5)}  ${(r.queryTokens + r.detailTokens).toString().padStart(5)}   ${ratio}%`,
  );
}

process.exit(0);
