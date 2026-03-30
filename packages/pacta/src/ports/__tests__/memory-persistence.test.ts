/**
 * Tests for JSONL memory persistence (PRD 031, Phase 5).
 *
 * Covers:
 *   - Load from JSONL file
 *   - Save (full rewrite) to JSONL file
 *   - Append single card
 *   - Corrupt line handling (graceful skip)
 *   - Load from non-existent file (empty result)
 *   - Round-trip (save then load)
 *   - Markdown export with grouping and confidence indicators
 *   - Empty export
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonlMemoryStore } from '../memory-persistence.js';
import type { FactCard } from '../memory-port.js';

// ── Test helpers ──────────────────────────────────────────────────

function tmpFile(): string {
  return join(tmpdir(), `memory-test-${randomUUID()}.jsonl`);
}

const cleanupFiles: string[] = [];

afterEach(async () => {
  for (const f of cleanupFiles) {
    try { await unlink(f); } catch { /* ignore */ }
  }
  cleanupFiles.length = 0;
});

function makeCard(overrides: Partial<FactCard> & { id: string; content: string }): FactCard {
  return {
    type: 'FACT',
    source: { task: 'test' },
    tags: [],
    created: 1700000000000,
    updated: 1700000000000,
    confidence: 0.8,
    links: [],
    ...overrides,
  };
}

// ── Load tests ────────────────────────────────────────────────────

describe('JsonlMemoryStore.load', () => {
  it('loads cards from a valid JSONL file', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const cards = [
      makeCard({ id: 'c1', content: 'First card' }),
      makeCard({ id: 'c2', content: 'Second card', type: 'RULE', confidence: 0.95 }),
    ];

    await writeFile(fp, cards.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf-8');

    const store = new JsonlMemoryStore(fp);
    const loaded = await store.load();

    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, 'c1');
    assert.equal(loaded[1].id, 'c2');
    assert.equal(loaded[1].type, 'RULE');
  });

  it('returns empty array for non-existent file', async () => {
    const store = new JsonlMemoryStore('/tmp/does-not-exist-' + randomUUID() + '.jsonl');
    const loaded = await store.load();
    assert.deepEqual(loaded, []);
  });

  it('skips corrupt lines gracefully', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const validCard = makeCard({ id: 'valid', content: 'Good card' });
    const lines = [
      JSON.stringify(validCard),
      'this is not json',
      '{"id": 123}',  // id is not a string
      JSON.stringify(makeCard({ id: 'valid2', content: 'Another good one' })),
    ];

    await writeFile(fp, lines.join('\n') + '\n', 'utf-8');

    // Suppress console.warn during this test
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    try {
      const store = new JsonlMemoryStore(fp);
      const loaded = await store.load();

      assert.equal(loaded.length, 2, 'should load only the 2 valid cards');
      assert.equal(loaded[0].id, 'valid');
      assert.equal(loaded[1].id, 'valid2');
      assert.ok(warnings.length > 0, 'should have produced warnings');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('handles empty file', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);
    await writeFile(fp, '', 'utf-8');

    const store = new JsonlMemoryStore(fp);
    const loaded = await store.load();
    assert.deepEqual(loaded, []);
  });
});

// ── Save tests ────────────────────────────────────────────────────

describe('JsonlMemoryStore.save', () => {
  it('writes all cards as JSONL (full rewrite)', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const cards = [
      makeCard({ id: 's1', content: 'Saved card 1' }),
      makeCard({ id: 's2', content: 'Saved card 2' }),
    ];

    const store = new JsonlMemoryStore(fp);
    await store.save(cards);

    const raw = await readFile(fp, 'utf-8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);

    const parsed1 = JSON.parse(lines[0]);
    assert.equal(parsed1.id, 's1');
  });

  it('overwrites existing content on save', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const store = new JsonlMemoryStore(fp);

    await store.save([makeCard({ id: 'old', content: 'Old data' })]);
    await store.save([makeCard({ id: 'new', content: 'New data' })]);

    const loaded = await store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'new');
  });
});

// ── Append tests ──────────────────────────────────────────────────

describe('JsonlMemoryStore.append', () => {
  it('appends a card to an existing file', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const store = new JsonlMemoryStore(fp);
    await store.save([makeCard({ id: 'a1', content: 'First' })]);
    await store.append(makeCard({ id: 'a2', content: 'Second' }));

    const loaded = await store.load();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, 'a1');
    assert.equal(loaded[1].id, 'a2');
  });

  it('creates file if it does not exist', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const store = new JsonlMemoryStore(fp);
    await store.append(makeCard({ id: 'new1', content: 'Created on append' }));

    const loaded = await store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'new1');
  });
});

// ── Round-trip test ───────────────────────────────────────────────

describe('JsonlMemoryStore round-trip', () => {
  it('preserves all FactCard fields through save/load cycle', async () => {
    const fp = tmpFile();
    cleanupFiles.push(fp);

    const original = makeCard({
      id: 'rt-1',
      content: 'Round-trip test card',
      type: 'HEURISTIC',
      source: { task: 'test-task', cycle: 3, module: 'observer' },
      tags: ['testing', 'persistence'],
      confidence: 0.73,
      links: ['rt-2', 'rt-3'],
      created: 1700000000000,
      updated: 1700000001000,
    });

    const store = new JsonlMemoryStore(fp);
    await store.save([original]);
    const loaded = await store.load();

    assert.equal(loaded.length, 1);
    const card = loaded[0];
    assert.equal(card.id, 'rt-1');
    assert.equal(card.content, 'Round-trip test card');
    assert.equal(card.type, 'HEURISTIC');
    assert.equal(card.source.task, 'test-task');
    assert.equal(card.source.cycle, 3);
    assert.equal(card.source.module, 'observer');
    assert.deepEqual(card.tags, ['testing', 'persistence']);
    assert.equal(card.confidence, 0.73);
    assert.deepEqual(card.links, ['rt-2', 'rt-3']);
  });
});

// ── Markdown export tests ─────────────────────────────────────────

describe('JsonlMemoryStore.exportMarkdown', () => {
  it('exports cards grouped by epistemic type', () => {
    const store = new JsonlMemoryStore('/dev/null');
    const cards: FactCard[] = [
      makeCard({ id: 'e1', content: 'Fact A', type: 'FACT', confidence: 0.9 }),
      makeCard({ id: 'e2', content: 'Rule B', type: 'RULE', confidence: 0.8 }),
      makeCard({ id: 'e3', content: 'Fact C', type: 'FACT', confidence: 0.6 }),
      makeCard({ id: 'e4', content: 'Heuristic D', type: 'HEURISTIC', confidence: 0.4 }),
    ];

    const md = store.exportMarkdown(cards);

    assert.ok(md.includes('# Memory Export'));
    assert.ok(md.includes('## Facts'));
    assert.ok(md.includes('## Rules'));
    assert.ok(md.includes('## Heuristics'));
    assert.ok(md.includes('4 card(s) across 3 type(s)'));
    // Confidence indicators
    assert.ok(md.includes('[*****]'), 'should have 5-star for 0.9 confidence');
    assert.ok(md.includes('[***  ]'), 'should have 3-star for 0.6 confidence');
  });

  it('returns placeholder for empty cards', () => {
    const store = new JsonlMemoryStore('/dev/null');
    const md = store.exportMarkdown([]);
    assert.ok(md.includes('No cards stored'));
  });

  it('includes tags in export', () => {
    const store = new JsonlMemoryStore('/dev/null');
    const cards = [
      makeCard({ id: 't1', content: 'Tagged card', tags: ['alpha', 'beta'] }),
    ];
    const md = store.exportMarkdown(cards);
    assert.ok(md.includes('alpha, beta'));
  });
});
