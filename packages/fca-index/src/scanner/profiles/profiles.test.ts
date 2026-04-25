// SPDX-License-Identifier: Apache-2.0
/**
 * Per-profile unit tests — verify each built-in LanguageProfile detects parts
 * for its own ecosystem. Tests use InMemoryFileSystem for deterministic, fast
 * fixtures.
 *
 * Coverage:
 *   - typescript: regression-only — covered exhaustively in fca-detector.test.ts
 *     and project-scanner.test.ts (default-profile path).
 *   - scala: file/dir/extractor rules.
 *   - python: file/dir/extractor rules.
 *   - go: file/dir/extractor rules.
 *   - markdown-only: README/docs detection, no source-file inference.
 *   - registry: BUILT_IN_PROFILES integrity, resolveLanguageProfiles round-trip,
 *     unknown name throws.
 */

import { describe, it, expect } from 'vitest';
import { FcaDetector } from '../fca-detector.js';
import { DocExtractor } from '../doc-extractor.js';
import { ProjectScanner } from '../project-scanner.js';
import { CoverageScorer } from '../coverage-scorer.js';
import { InMemoryFileSystem } from '../test-helpers/in-memory-fs.js';
import {
  BUILT_IN_PROFILES,
  DEFAULT_LANGUAGES,
  LanguageProfileError,
  resolveLanguageProfiles,
  scalaProfile,
  pythonProfile,
  goProfile,
  markdownOnlyProfile,
  typescriptProfile,
} from './index.js';

function makeScanner(tree: Record<string, string>, languages = DEFAULT_LANGUAGES) {
  const fs = new InMemoryFileSystem(tree);
  const detector = new FcaDetector(fs, languages);
  const scorer = new CoverageScorer();
  return {
    fs,
    scanner: new ProjectScanner(fs, detector, scorer, languages),
  };
}

// ── Scala profile ─────────────────────────────────────────────────────────────

describe('scala profile', () => {
  it('detects port from *Port.scala filename', async () => {
    const fs = new InMemoryFileSystem({
      '/project/SessionPort.scala': 'trait SessionPort { def open(): Unit }',
    });
    const detector = new FcaDetector(fs, [scalaProfile]);
    const parts = await detector.detect('/project', {});
    expect(parts.find(p => p.part === 'port')?.filePath).toBe('/project/SessionPort.scala');
  });

  it('detects verification from *Spec.scala and *Test.scala', async () => {
    const specFs = new InMemoryFileSystem({
      '/p/SessionSpec.scala': 'class SessionSpec extends AnyFunSuite {}',
    });
    const specParts = await new FcaDetector(specFs, [scalaProfile]).detect('/p', {});
    expect(specParts[0].part).toBe('verification');

    const testFs = new InMemoryFileSystem({
      '/p/SessionTest.scala': 'class SessionTest extends junit.Test {}',
    });
    const testParts = await new FcaDetector(testFs, [scalaProfile]).detect('/p', {});
    expect(testParts[0].part).toBe('verification');
  });

  it('detects interface from package.scala', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.scala': 'package object api { trait Foo }',
    });
    const detector = new FcaDetector(fs, [scalaProfile]);
    const parts = await detector.detect('/project', {});
    expect(parts.find(p => p.part === 'interface')?.filePath).toBe('/project/package.scala');
  });

  it('detects observability from *Metrics.scala', async () => {
    const fs = new InMemoryFileSystem({
      '/p/SessionMetrics.scala': 'object SessionMetrics { val counter = 0 }',
    });
    const parts = await new FcaDetector(fs, [scalaProfile]).detect('/p', {});
    expect(parts.find(p => p.part === 'observability')).toBeDefined();
  });

  it('qualifies a directory with build.sbt as L3', async () => {
    const root = '/project';
    const { scanner } = makeScanner(
      {
        '/project/modules/api/build.sbt': 'name := "api"',
        '/project/modules/api/SessionPort.scala': 'trait SessionPort { def open(): Unit }',
        '/project/modules/api/Session.scala': 'class Session {}',
      },
      [scalaProfile],
    );
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['modules/**'],
    });
    const api = components.find(c => c.path.includes('modules/api'));
    expect(api).toBeDefined();
    expect(api?.level).toBe('L3');
  });

  it('extracts ScalaDoc as the doc block', async () => {
    const fs = new InMemoryFileSystem({
      '/p/Foo.scala': '/** Service description.\n  * @param x input\n  */\nclass Foo {}',
    });
    const extractor = new DocExtractor(fs, [scalaProfile]);
    const excerpt = await extractor.extract('/p/Foo.scala', 'port');
    expect(excerpt).toContain('Service description');
  });

  it('extracts top-level Scala signatures from package.scala', async () => {
    const fs = new InMemoryFileSystem({
      '/p/package.scala': [
        'package object api {',
        '  trait SessionPort',
        '  case class SessionId(value: String)',
        '  def newSession(): SessionPort = ???',
        '}',
      ].join('\n'),
    });
    const extractor = new DocExtractor(fs, [scalaProfile]);
    const excerpt = await extractor.extract('/p/package.scala', 'interface');
    expect(excerpt).toContain('trait SessionPort');
    expect(excerpt).toContain('case class SessionId');
    expect(excerpt).toContain('def newSession');
  });
});

// ── Python profile ────────────────────────────────────────────────────────────

describe('python profile', () => {
  it('detects port from *_port.py filename', async () => {
    const fs = new InMemoryFileSystem({
      '/project/session_port.py': 'class SessionPort: ...',
    });
    const parts = await new FcaDetector(fs, [pythonProfile]).detect('/project', {});
    expect(parts.find(p => p.part === 'port')?.filePath).toBe('/project/session_port.py');
  });

  it('detects verification from test_*.py and *_test.py', async () => {
    const fs = new InMemoryFileSystem({
      '/p/test_session.py': 'def test_open(): pass',
    });
    const parts = await new FcaDetector(fs, [pythonProfile]).detect('/p', {});
    expect(parts[0].part).toBe('verification');

    const fs2 = new InMemoryFileSystem({
      '/p/session_test.py': 'def test_open(): pass',
    });
    const parts2 = await new FcaDetector(fs2, [pythonProfile]).detect('/p', {});
    expect(parts2[0].part).toBe('verification');
  });

  it('detects interface from __init__.py', async () => {
    const fs = new InMemoryFileSystem({
      '/p/__init__.py': 'from .session import Session\n__all__ = ["Session"]',
    });
    const parts = await new FcaDetector(fs, [pythonProfile]).detect('/p', {});
    expect(parts.find(p => p.part === 'interface')?.filePath).toBe('/p/__init__.py');
  });

  it('qualifies a directory with pyproject.toml as L3', async () => {
    const root = '/project';
    const { scanner } = makeScanner(
      {
        '/project/src/myapp/pyproject.toml': '[project]\nname = "myapp"',
        '/project/src/myapp/__init__.py': 'from .core import run',
        '/project/src/myapp/core.py': 'def run(): pass',
      },
      [pythonProfile],
    );
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['src/**'],
    });
    const myapp = components.find(c => c.path.includes('myapp'));
    expect(myapp).toBeDefined();
    expect(myapp?.level).toBe('L3');
  });

  it('extracts module-level docstring as the doc block', async () => {
    const fs = new InMemoryFileSystem({
      '/p/foo.py': '"""Module docstring describing foo."""\nimport os',
    });
    const extractor = new DocExtractor(fs, [pythonProfile]);
    const excerpt = await extractor.extract('/p/foo.py', 'port');
    expect(excerpt).toContain('Module docstring');
  });

  it('extracts top-level python signatures from __init__.py', async () => {
    const fs = new InMemoryFileSystem({
      '/p/__init__.py': [
        'from .session import Session',
        'import logging',
        '__all__ = ["Session"]',
        '',
        'def helper(): pass',
        '',
        'class Foo: pass',
      ].join('\n'),
    });
    const extractor = new DocExtractor(fs, [pythonProfile]);
    const excerpt = await extractor.extract('/p/__init__.py', 'interface');
    expect(excerpt).toContain('from .session import Session');
    expect(excerpt).toContain('def helper');
    expect(excerpt).toContain('class Foo');
  });
});

// ── Go profile ────────────────────────────────────────────────────────────────

describe('go profile', () => {
  it('detects port from *_port.go filename', async () => {
    const fs = new InMemoryFileSystem({
      '/project/session_port.go': 'package api\ntype SessionPort interface { Open() }',
    });
    const parts = await new FcaDetector(fs, [goProfile]).detect('/project', {});
    expect(parts.find(p => p.part === 'port')?.filePath).toBe('/project/session_port.go');
  });

  it('detects verification from *_test.go', async () => {
    const fs = new InMemoryFileSystem({
      '/p/session_test.go': 'package api\nimport "testing"\nfunc TestOpen(t *testing.T) {}',
    });
    const parts = await new FcaDetector(fs, [goProfile]).detect('/p', {});
    expect(parts[0].part).toBe('verification');
  });

  it('detects interface from doc.go', async () => {
    const fs = new InMemoryFileSystem({
      '/p/doc.go': '// Package api describes the public surface.\npackage api',
    });
    const parts = await new FcaDetector(fs, [goProfile]).detect('/p', {});
    expect(parts.find(p => p.part === 'interface')?.filePath).toBe('/p/doc.go');
  });

  it('qualifies a directory with go.mod as L3', async () => {
    const root = '/project';
    const { scanner } = makeScanner(
      {
        '/project/services/api/go.mod': 'module example.com/api',
        '/project/services/api/doc.go': '// Package api.\npackage api',
        '/project/services/api/handler.go': 'package api\nfunc Handle() {}',
      },
      [goProfile],
    );
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['services/**'],
    });
    const api = components.find(c => c.path.includes('services/api'));
    expect(api).toBeDefined();
    expect(api?.level).toBe('L3');
  });

  it('extracts godoc leading // comments as the doc block', async () => {
    const fs = new InMemoryFileSystem({
      '/p/handler.go': '// Handler exposes the HTTP routes.\n// It depends on SessionPort.\npackage api',
    });
    const extractor = new DocExtractor(fs, [goProfile]);
    const excerpt = await extractor.extract('/p/handler.go', 'port');
    expect(excerpt).toContain('Handler exposes the HTTP routes');
  });

  it('extracts top-level go signatures from doc.go', async () => {
    const fs = new InMemoryFileSystem({
      '/p/doc.go': [
        '// Package api.',
        'package api',
        '',
        'type SessionPort interface { Open() }',
        'func New() SessionPort { return nil }',
        'var Default SessionPort',
        'const Limit = 10',
      ].join('\n'),
    });
    const extractor = new DocExtractor(fs, [goProfile]);
    const excerpt = await extractor.extract('/p/doc.go', 'interface');
    expect(excerpt).toContain('type SessionPort interface');
    expect(excerpt).toContain('func New');
    expect(excerpt).toContain('var Default');
    expect(excerpt).toContain('const Limit');
  });
});

// ── markdown-only profile ─────────────────────────────────────────────────────

describe('markdown-only profile', () => {
  it('detects only documentation parts from README and *.md', async () => {
    const fs = new InMemoryFileSystem({
      '/docs/README.md': '# Docs\n\nThis is the index.',
      '/docs/guide.md': '# Guide\n\nHow to use.',
    });
    const parts = await new FcaDetector(fs, [markdownOnlyProfile]).detect('/docs', {});
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every(p => p.part === 'documentation' || p.part === 'boundary')).toBe(true);
  });

  it('does NOT detect TS/Scala/Python source files as components', async () => {
    const fs = new InMemoryFileSystem({
      '/project/src/foo.ts': 'export const x = 1;',
      '/project/src/foo.scala': 'object Foo',
      '/project/src/foo.py': 'def foo(): pass',
    });
    const parts = await new FcaDetector(fs, [markdownOnlyProfile]).detect('/project/src', {});
    // markdown-only assigns no parts to source files — only README/docs.
    expect(parts.find(p => p.part === 'interface')).toBeUndefined();
    expect(parts.find(p => p.part === 'verification')).toBeUndefined();
  });

  it('qualifies a docs directory with only a README as a component', async () => {
    const root = '/project';
    const { scanner } = makeScanner(
      {
        '/project/docs/README.md': '# Docs\n\nIndex.',
      },
      [markdownOnlyProfile],
    );
    const components = await scanner.scan({
      projectRoot: root,
      sourcePatterns: ['docs/**'],
    });
    const docs = components.find(c => c.path.includes('docs'));
    expect(docs).toBeDefined();
    expect(docs?.parts.find(p => p.part === 'documentation')).toBeDefined();
  });
});

// ── TypeScript profile (regression sanity — covered fully elsewhere) ─────────

describe('typescript profile (regression sanity)', () => {
  it('is the default when no languages are passed', () => {
    expect(DEFAULT_LANGUAGES).toEqual([typescriptProfile]);
  });

  it('matches v0.3.x rules — index.ts with export → interface', async () => {
    const fs = new InMemoryFileSystem({
      '/p/index.ts': 'export interface Foo {}',
    });
    const parts = await new FcaDetector(fs, [typescriptProfile]).detect('/p', {});
    expect(parts.find(p => p.part === 'interface')?.filePath).toBe('/p/index.ts');
  });

  it('matches v0.3.x rules — *.test.ts → verification', async () => {
    const fs = new InMemoryFileSystem({
      '/p/foo.test.ts': 'import { it } from "vitest";',
    });
    const parts = await new FcaDetector(fs, [typescriptProfile]).detect('/p', {});
    expect(parts[0].part).toBe('verification');
  });
});

// ── Registry + resolver ──────────────────────────────────────────────────────

describe('BUILT_IN_PROFILES registry', () => {
  it('contains all 5 built-in profiles', () => {
    const names = Object.keys(BUILT_IN_PROFILES).sort();
    expect(names).toEqual(['go', 'markdown-only', 'python', 'scala', 'typescript']);
  });

  it('every built-in profile has consistent name field', () => {
    for (const [key, profile] of Object.entries(BUILT_IN_PROFILES)) {
      expect(profile.name).toBe(key);
    }
  });

  it('every built-in profile declares at least one source extension', () => {
    for (const profile of Object.values(BUILT_IN_PROFILES)) {
      expect(profile.sourceExtensions.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveLanguageProfiles', () => {
  it('resolves built-in names in order', () => {
    const resolved = resolveLanguageProfiles(['typescript', 'scala']);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(typescriptProfile);
    expect(resolved[1]).toBe(scalaProfile);
  });

  it('returns empty array for empty input', () => {
    expect(resolveLanguageProfiles([])).toEqual([]);
  });

  it('throws LanguageProfileError for unknown profile name', () => {
    expect(() => resolveLanguageProfiles(['kotlin'])).toThrow(LanguageProfileError);
    expect(() => resolveLanguageProfiles(['kotlin'])).toThrow(/Unknown language profile/);
  });

  it('error message lists known built-in profiles', () => {
    try {
      resolveLanguageProfiles(['nonexistent']);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toContain('typescript');
      expect((e as Error).message).toContain('scala');
      expect((e as Error).message).toContain('python');
      expect((e as Error).message).toContain('go');
      expect((e as Error).message).toContain('markdown-only');
    }
  });
});
