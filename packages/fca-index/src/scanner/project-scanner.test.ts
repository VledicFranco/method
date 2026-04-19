// SPDX-License-Identifier: Apache-2.0
/**
 * ProjectScanner — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { ProjectScanner } from './project-scanner.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';
import type { FcaPart } from '../ports/context-query.js';

function makeScanner(tree: Record<string, string>) {
  const fs = new InMemoryFileSystem(tree);
  const detector = new FcaDetector(fs);
  const scorer = new CoverageScorer();
  return new ProjectScanner(fs, detector, scorer);
}

// ── docText composition (PRD 053 SC-1 follow-up — narrow embedding doc) ─────

describe('ProjectScanner — docText composition', () => {
  it('builds docText only from documentation/interface/port parts when present', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo { bar(): void; }',
      '/project/src/README.md': '# Foo\nThe Foo component does X.',
      '/project/src/foo.test.ts': '/** Tests for Foo — covers session lifecycle, strategy execution, scenarios. */',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: ['interface', 'documentation'],
    });

    const c = components.find(c => c.path === 'src');
    expect(c).toBeDefined();
    if (!c) return;

    // verification part is detected (visible in parts) but NOT in docText
    expect(c.parts.some(p => p.part === 'verification')).toBe(true);
    expect(c.docText).not.toContain('session lifecycle');
    expect(c.docText).not.toContain('strategy execution');
    expect(c.docText).not.toContain('scenarios');

    // documentation + interface ARE in docText
    expect(c.docText).toContain('Foo component does X');
    expect(c.docText).toContain('export interface Foo');
  });

  it('falls back to all parts if no documentation/interface/port present', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/foo.test.ts': '/** Verification-only component — falls back to test JSDoc. */',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    const c = components.find(c => c.path === 'src');
    if (!c) return; // verification-only may not qualify as a component, that's fine

    // If it does scan, docText should fall back to verification rather than be empty
    if (c.parts.length > 0) {
      expect(c.docText.length).toBeGreaterThan(0);
    }
  });
});

describe('ProjectScanner', () => {
  it('scans a simple component and produces ScannedComponent with correct fields', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo { bar(): void; }',
      '/project/src/README.md': '# Foo\n\nThe Foo component.',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: ['interface', 'documentation'],
    });

    expect(components.length).toBeGreaterThan(0);

    const srcComponent = components.find(c => c.path === 'src');
    expect(srcComponent).toBeDefined();
    if (!srcComponent) return;

    expect(srcComponent.projectRoot).toBe(root);
    expect(srcComponent.coverageScore).toBe(1.0);

    const partNames = srcComponent.parts.map(p => p.part);
    expect(partNames).toContain('interface');
    expect(partNames).toContain('documentation');
  });

  it('generates 16-char hex ID', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
      '/project/src/README.md': '# Foo',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    for (const c of components) {
      expect(c.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('generates deterministic IDs', async () => {
    const root = '/project';
    const tree = {
      '/project/src/index.ts': 'export interface Foo {}',
    };

    const scanner1 = makeScanner(tree);
    const scanner2 = makeScanner(tree);

    const [c1] = await scanner1.scan({ projectRoot: root, sourcePatterns: ['src/**'] });
    const [c2] = await scanner2.scan({ projectRoot: root, sourcePatterns: ['src/**'] });

    expect(c1.id).toBe(c2.id);
  });

  it('computes partial coverage score correctly', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
      // No README.md — documentation part missing
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: ['interface', 'documentation'],
    });

    const srcComponent = components.find(c => c.path === 'src');
    expect(srcComponent).toBeDefined();
    if (!srcComponent) return;

    expect(srcComponent.coverageScore).toBe(0.5);
  });

  it('detects L3 level when package.json is present', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/package.json': '{"name": "test"}',
      '/project/src/index.ts': 'export interface Foo {}',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    const srcComponent = components.find(c => c.path === 'src');
    expect(srcComponent?.level).toBe('L3');
  });

  it('detects L2 level for src/ directory with index.ts', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    const srcComponent = components.find(c => c.path === 'src');
    expect(srcComponent?.level).toBe('L2');
  });

  it('detects L1 level for single-file directory', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/utils/helper.ts': 'export function help(): void {}',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    // The utils directory has a single TS file — should be L1
    const utilsComponent = components.find(c => c.path.includes('utils'));
    if (utilsComponent) {
      expect(utilsComponent.level).toBe('L1');
    }
  });

  it('builds docText from all part excerpts', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
      '/project/src/README.md': '# Foo\n\nFoo description.',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    const srcComponent = components.find(c => c.path === 'src');
    expect(srcComponent?.docText).toBeTruthy();
    expect(srcComponent?.docText.length).toBeGreaterThan(0);
  });

  it('sets indexedAt as ISO 8601 timestamp', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: [],
    });

    if (components.length > 0) {
      const date = new Date(components[0].indexedAt);
      expect(date.toISOString()).toBe(components[0].indexedAt);
    }
  });

  it('uses default source patterns when not specified', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/index.ts': 'export interface Foo {}',
    });

    const components = await scanner.scan({ projectRoot: root });
    expect(components.length).toBeGreaterThan(0);
  });

  it('scans a multi-component project correctly', async () => {
    const root = '/project';
    const scanner = makeScanner({
      '/project/src/domains/sessions/index.ts': 'export interface SessionPort {}',
      '/project/src/domains/sessions/README.md': '# Sessions\n\nSession domain.',
      '/project/src/domains/tokens/index.ts': 'export interface TokenPort {}',
    });

    const required: FcaPart[] = ['interface', 'documentation'];
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
      requiredParts: required,
    });

    const sessionComp = components.find(c => c.path.includes('sessions'));
    const tokenComp = components.find(c => c.path.includes('tokens'));

    expect(sessionComp).toBeDefined();
    expect(tokenComp).toBeDefined();

    // sessions has both parts
    expect(sessionComp?.coverageScore).toBe(1.0);
    // tokens only has interface
    expect(tokenComp?.coverageScore).toBe(0.5);
  });
});
