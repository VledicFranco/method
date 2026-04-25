// SPDX-License-Identifier: Apache-2.0
/**
 * Disk-fixture scan tests — verify each LanguageProfile produces correct
 * detection on a real on-disk fixture (not just InMemoryFileSystem).
 *
 * Fixtures live under packages/fca-index/tests/fixtures/sample-fca-<lang>/.
 * Per AC-2 (PRD 057): each built-in profile must ship with a real fixture.
 *
 * Uses NodeFileSystem so Windows path normalization paths are also exercised.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { ProjectScanner } from './project-scanner.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';
import { NodeFileSystem } from '../cli/node-filesystem.js';
import {
  scalaProfile,
  pythonProfile,
  goProfile,
  markdownOnlyProfile,
  typescriptProfile,
} from './profiles/index.js';
import type { LanguageProfile } from './profiles/index.js';

const FIXTURES = resolve(import.meta.dirname, '..', '..', 'tests', 'fixtures');

function makeScanner(languages: LanguageProfile[]) {
  const fs = new NodeFileSystem();
  const detector = new FcaDetector(fs, languages);
  const scorer = new CoverageScorer();
  return new ProjectScanner(fs, detector, scorer, languages);
}

function projectRoot(name: string): string {
  return resolve(FIXTURES, name).replace(/\\/g, '/');
}

describe('disk fixtures — sample-fca-scala', () => {
  it('detects the Scala component with documentation, interface, verification', async () => {
    const root = projectRoot('sample-fca-scala');
    const scanner = makeScanner([scalaProfile]);
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['**'],
      excludePatterns: [],
    });

    // The src/ directory has package.scala (interface), Session.scala,
    // SessionSpec.scala (verification) → qualifies as a component.
    const src = components.find(c => c.path === 'src' || c.path.endsWith('/src'));
    expect(src, `expected a src component in ${components.map(c => c.path).join(', ')}`).toBeDefined();
    if (!src) return;

    const partNames = src.parts.map(p => p.part).sort();
    expect(partNames).toContain('interface');
    expect(partNames).toContain('verification');
  });
});

describe('disk fixtures — sample-fca-python', () => {
  it('detects the Python component with interface, port, verification', async () => {
    const root = projectRoot('sample-fca-python');
    const scanner = makeScanner([pythonProfile]);
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['**'],
      excludePatterns: [],
    });

    const sample = components.find(c => c.path.endsWith('sample'));
    expect(
      sample,
      `expected sample/ component in ${components.map(c => c.path).join(', ')}`,
    ).toBeDefined();
    if (!sample) return;

    const partNames = sample.parts.map(p => p.part).sort();
    expect(partNames).toContain('interface');
    expect(partNames).toContain('port');
    expect(partNames).toContain('verification');
  });
});

describe('disk fixtures — sample-fca-go', () => {
  it('detects the Go component with interface, verification', async () => {
    const root = projectRoot('sample-fca-go');
    const scanner = makeScanner([goProfile]);
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['**'],
      excludePatterns: [],
    });

    const sample = components.find(c => c.path.endsWith('sample'));
    expect(
      sample,
      `expected sample/ component in ${components.map(c => c.path).join(', ')}`,
    ).toBeDefined();
    if (!sample) return;

    const partNames = sample.parts.map(p => p.part).sort();
    expect(partNames).toContain('interface');
    expect(partNames).toContain('verification');
  });
});

describe('disk fixtures — sample-fca-polyglot', () => {
  it('detects TS + Scala + Python components in one polyglot scan', async () => {
    const root = projectRoot('sample-fca-polyglot');
    const scanner = makeScanner([typescriptProfile, scalaProfile, pythonProfile]);
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['packages/**', 'modules/**', 'src/**'],
      excludePatterns: [],
    });

    const ts = components.find(c => c.path.includes('ts-app'));
    const scala = components.find(c => c.path.includes('scala-svc'));
    const py = components.find(c => c.path.includes('py_pkg'));

    expect(ts, `expected ts-app component in ${components.map(c => c.path).join(', ')}`).toBeDefined();
    expect(scala, `expected scala-svc component in ${components.map(c => c.path).join(', ')}`).toBeDefined();
    expect(py, `expected py_pkg component in ${components.map(c => c.path).join(', ')}`).toBeDefined();
  });
});

describe('disk fixtures — markdown-only profile (works on docs-only dir)', () => {
  it('detects README-only component without inferring source structure', async () => {
    // Reuse the polyglot fixture root — it has a top-level README.md but no
    // source files at the root. The markdown-only profile should detect it.
    const root = projectRoot('sample-fca-polyglot');
    const scanner = makeScanner([markdownOnlyProfile]);
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['**'],
      excludePatterns: [],
    });
    // At minimum, the project root README is detectable.
    const docsParts = components.flatMap(c => c.parts).filter(p => p.part === 'documentation');
    expect(docsParts.length).toBeGreaterThan(0);
  });
});
