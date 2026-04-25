// SPDX-License-Identifier: Apache-2.0
/**
 * Polyglot scan — AC-3 from PRD 057.
 *
 * Verifies that when multiple LanguageProfiles are active, the ProjectScanner
 * detects components from each ecosystem in a single scan, with each
 * component's level and parts correctly attributed by its owning profile.
 */

import { describe, it, expect } from 'vitest';
import { ProjectScanner } from './project-scanner.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';
import {
  typescriptProfile,
  scalaProfile,
  pythonProfile,
} from './profiles/index.js';

function makeScanner(tree: Record<string, string>) {
  const languages = [typescriptProfile, scalaProfile, pythonProfile];
  const fs = new InMemoryFileSystem(tree);
  const detector = new FcaDetector(fs, languages);
  const scorer = new CoverageScorer();
  return new ProjectScanner(fs, detector, scorer, languages);
}

describe('polyglot scan (TS + Scala + Python)', () => {
  it('detects components from all three ecosystems in one scan', async () => {
    const root = '/poly';
    const scanner = makeScanner({
      // TS package
      '/poly/packages/ts-app/package.json': '{"name": "ts-app"}',
      '/poly/packages/ts-app/index.ts': 'export interface TsApp { run(): void; }',
      '/poly/packages/ts-app/README.md': '# ts-app\n\nThe TS application.',
      '/poly/packages/ts-app/server.ts': 'export class Server {}',

      // Scala module
      '/poly/modules/scala-svc/build.sbt': 'name := "scala-svc"',
      '/poly/modules/scala-svc/package.scala': 'package object svc { trait SessionPort }',
      '/poly/modules/scala-svc/README.md': '# scala-svc\n\nScala service.',
      '/poly/modules/scala-svc/Session.scala': 'class Session {}',

      // Python module
      '/poly/src/py_pkg/pyproject.toml': '[project]\nname="py_pkg"',
      '/poly/src/py_pkg/__init__.py': '"""py_pkg public API."""\nfrom .core import run',
      '/poly/src/py_pkg/README.md': '# py_pkg\n\nPython package.',
      '/poly/src/py_pkg/core.py': 'def run(): pass',
    });

    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['packages/**', 'modules/**', 'src/**'],
    });

    const tsApp = components.find(c => c.path.includes('ts-app'));
    const scalaSvc = components.find(c => c.path.includes('scala-svc'));
    const pyPkg = components.find(c => c.path.includes('py_pkg'));

    expect(tsApp, 'TS package should be detected').toBeDefined();
    expect(scalaSvc, 'Scala module should be detected').toBeDefined();
    expect(pyPkg, 'Python package should be detected').toBeDefined();

    // Each is detected as L3 by its own packageMarker.
    expect(tsApp?.level).toBe('L3');
    expect(scalaSvc?.level).toBe('L3');
    expect(pyPkg?.level).toBe('L3');

    // Each has documentation + interface parts (the exact filenames vary by language).
    for (const c of [tsApp, scalaSvc, pyPkg]) {
      const partNames = c?.parts.map(p => p.part) ?? [];
      expect(partNames, `component ${c?.path} should have documentation`).toContain('documentation');
      expect(partNames, `component ${c?.path} should have interface`).toContain('interface');
    }

    // The Scala component's interface excerpt comes from package.scala, not index.ts.
    const scalaIface = scalaSvc?.parts.find(p => p.part === 'interface');
    expect(scalaIface?.filePath).toContain('package.scala');

    // The Python component's interface excerpt comes from __init__.py.
    const pyIface = pyPkg?.parts.find(p => p.part === 'interface');
    expect(pyIface?.filePath).toContain('__init__.py');

    // The TS component's interface excerpt comes from index.ts.
    const tsIface = tsApp?.parts.find(p => p.part === 'interface');
    expect(tsIface?.filePath).toContain('index.ts');
  });

  it('preserves per-language detection (Scala test files do not match TS verification rules)', async () => {
    const root = '/poly';
    const scanner = makeScanner({
      '/poly/modules/svc/SessionSpec.scala': 'class SessionSpec {}',
      '/poly/modules/svc/Session.scala': 'class Session {}',
    });
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['modules/**'],
    });
    const svc = components.find(c => c.path.includes('svc'));
    expect(svc?.parts.find(p => p.part === 'verification')?.filePath).toContain('SessionSpec.scala');
  });

  it('first-matching-rule-wins across profiles for shared file extensions', async () => {
    // README.md is matched by TS, Scala, Python, and markdown-only profiles.
    // The first profile in the list wins. The scanner deduplicates by part:
    // README.md is detected exactly once as `documentation`.
    const root = '/poly';
    const scanner = makeScanner({
      '/poly/packages/foo/README.md': '# foo\n\nThe foo component.',
      '/poly/packages/foo/index.ts': 'export interface Foo {}',
    });
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['packages/**'],
    });
    const foo = components.find(c => c.path.includes('foo'));
    const docParts = foo?.parts.filter(p => p.part === 'documentation') ?? [];
    expect(docParts).toHaveLength(1);
  });
});
