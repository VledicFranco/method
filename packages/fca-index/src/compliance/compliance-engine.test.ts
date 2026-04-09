/**
 * ComplianceEngine + TemplateGenerator — unit tests.
 *
 * All tests use InMemoryIndexStore as the store double.
 * No embedding calls, no file I/O — pure domain logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from './compliance-engine.js';
import { TemplateGenerator } from './template-generator.js';
import { InMemoryIndexStore } from '../index-store/in-memory-store.js';
import { ComplianceSuggestionError } from '../ports/compliance-suggestion.js';
import type { IndexEntry } from '../ports/internal/index-store.js';
import type { FcaPart } from '../ports/context-query.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const ALL_PARTS: FcaPart[] = [
  'interface',
  'boundary',
  'port',
  'domain',
  'architecture',
  'verification',
  'observability',
  'documentation',
];

function makeEntry(path: string, parts: FcaPart[], projectRoot = '/test'): IndexEntry {
  const score = parts.length / ALL_PARTS.length;
  return {
    id: path,
    projectRoot,
    path,
    level: 'L2',
    parts: parts.map((p) => ({ part: p, filePath: `${path}/${p}.ts`, excerpt: '' })),
    coverageScore: score,
    embedding: [],
    indexedAt: new Date().toISOString(),
  };
}

// ── ComplianceEngine tests ────────────────────────────────────────────────────

describe('ComplianceEngine', () => {
  let store: InMemoryIndexStore;

  beforeEach(() => {
    store = new InMemoryIndexStore();
  });

  it('returns empty missingParts when component has all 8 parts', async () => {
    await store.upsertComponent(makeEntry('src/fully-covered', ALL_PARTS));

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/fully-covered', projectRoot: '/test' });

    expect(result.missingParts).toHaveLength(0);
    expect(result.componentPath).toBe('src/fully-covered');
    expect(result.currentScore).toBeCloseTo(1.0, 10);
  });

  it('returns suggestions for each missing part', async () => {
    const presentParts: FcaPart[] = ['interface', 'documentation'];
    await store.upsertComponent(makeEntry('src/partial', presentParts));

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/partial', projectRoot: '/test' });

    const missingPartNames = result.missingParts.map((s) => s.part);
    const expectedMissing: FcaPart[] = ALL_PARTS.filter(
      (p) => !presentParts.includes(p),
    );
    expect(missingPartNames.sort()).toEqual(expectedMissing.sort());
  });

  it('returns suggestions for ALL parts when component has no parts', async () => {
    await store.upsertComponent(makeEntry('src/undocumented', []));

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/undocumented', projectRoot: '/test' });

    expect(result.missingParts).toHaveLength(ALL_PARTS.length);
    expect(result.currentScore).toBe(0);
  });

  it('each suggestion has non-empty suggestedFile and templateContent', async () => {
    await store.upsertComponent(makeEntry('src/sparse', []));

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/sparse', projectRoot: '/test' });

    for (const stub of result.missingParts) {
      expect(stub.suggestedFile).toBeTruthy();
      expect(stub.templateContent).toBeTruthy();
      expect(stub.templateContent.trim().length).toBeGreaterThan(0);
    }
  });

  it('throws NOT_FOUND when component path is not in index', async () => {
    // Add a different component so the index is not empty
    await store.upsertComponent(makeEntry('src/other', ['interface']));

    const engine = new ComplianceEngine(store);

    await expect(
      engine.suggest({ path: 'src/missing', projectRoot: '/test' }),
    ).rejects.toThrow(ComplianceSuggestionError);

    try {
      await engine.suggest({ path: 'src/missing', projectRoot: '/test' });
    } catch (err) {
      expect(err).toBeInstanceOf(ComplianceSuggestionError);
      expect((err as ComplianceSuggestionError).code).toBe('NOT_FOUND');
    }
  });

  it('throws INDEX_NOT_FOUND when project has no components in index', async () => {
    const engine = new ComplianceEngine(store);

    await expect(
      engine.suggest({ path: 'src/anything', projectRoot: '/test' }),
    ).rejects.toThrow(ComplianceSuggestionError);

    try {
      await engine.suggest({ path: 'src/anything', projectRoot: '/test' });
    } catch (err) {
      expect(err).toBeInstanceOf(ComplianceSuggestionError);
      expect((err as ComplianceSuggestionError).code).toBe('INDEX_NOT_FOUND');
    }
  });

  it('includes the correct part in each suggestion object', async () => {
    await store.upsertComponent(makeEntry('src/check-parts', []));

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/check-parts', projectRoot: '/test' });

    const returnedParts = result.missingParts.map((s) => s.part);
    for (const part of ALL_PARTS) {
      expect(returnedParts).toContain(part);
    }
  });

  it('reflects currentScore from the index entry', async () => {
    const entry = makeEntry('src/scored', ['interface', 'documentation']);
    await store.upsertComponent(entry);

    const engine = new ComplianceEngine(store);
    const result = await engine.suggest({ path: 'src/scored', projectRoot: '/test' });

    expect(result.currentScore).toBeCloseTo(entry.coverageScore, 10);
  });
});

// ── TemplateGenerator tests ───────────────────────────────────────────────────

describe('TemplateGenerator', () => {
  const generator = new TemplateGenerator();

  it.each(ALL_PARTS)('generates non-empty content for part: %s', (part) => {
    const result = generator.generate(part, 'src/my-component');
    expect(result.part).toBe(part);
    expect(result.suggestedFile).toBeTruthy();
    expect(result.templateContent.trim().length).toBeGreaterThan(0);
  });

  it('interface part generates index.ts with export keyword', () => {
    const result = generator.generate('interface', 'src/my-comp');
    expect(result.suggestedFile).toBe('index.ts');
    expect(result.templateContent).toContain('export');
  });

  it('documentation part generates README.md', () => {
    const result = generator.generate('documentation', 'src/my-comp');
    expect(result.suggestedFile).toBe('README.md');
    expect(result.templateContent).toContain('#');
  });

  it('verification part generates a .test.ts file with vitest import', () => {
    const result = generator.generate('verification', 'src/my-comp');
    expect(result.suggestedFile).toMatch(/\.test\.ts$/);
    expect(result.templateContent).toContain('vitest');
  });

  it('port part generates ports.ts with an interface', () => {
    const result = generator.generate('port', 'src/my-comp');
    expect(result.suggestedFile).toBe('ports.ts');
    expect(result.templateContent).toContain('interface');
  });

  it('architecture part generates ARCHITECTURE.md', () => {
    const result = generator.generate('architecture', 'src/my-comp');
    expect(result.suggestedFile).toBe('ARCHITECTURE.md');
  });

  it('derives PascalCase name from kebab-case path segment', () => {
    const result = generator.generate('interface', 'packages/my-cool-service');
    // The component name "my-cool-service" → "MyCoolService"
    expect(result.templateContent).toContain('MyCoolService');
  });

  it('derives PascalCase name from snake_case path segment', () => {
    const result = generator.generate('port', 'src/query_engine');
    expect(result.templateContent).toContain('QueryEngine');
  });

  it('all generated files have non-empty templateContent', () => {
    for (const part of ALL_PARTS) {
      const result = generator.generate(part, 'src/test-component');
      expect(result.templateContent.length).toBeGreaterThan(20);
    }
  });
});
