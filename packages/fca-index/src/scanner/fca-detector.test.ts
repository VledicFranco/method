/**
 * FcaDetector — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { FcaDetector } from './fca-detector.js';
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';

describe('FcaDetector', () => {
  it('detects documentation from README.md', async () => {
    const fs = new InMemoryFileSystem({
      '/project/README.md': '# My Component\n\nThis is the component description.',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(1);
    expect(parts[0].part).toBe('documentation');
    expect(parts[0].filePath).toBe('/project/README.md');
    expect(parts[0].excerpt).toContain('My Component');
  });

  it('detects interface from index.ts with exports', async () => {
    const fs = new InMemoryFileSystem({
      '/project/index.ts': 'export interface Foo { bar(): void; }\nexport function baz(): Foo { return {} as Foo; }',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(1);
    expect(parts[0].part).toBe('interface');
    expect(parts[0].filePath).toBe('/project/index.ts');
  });

  it('does not detect interface from index.ts without exports', async () => {
    const fs = new InMemoryFileSystem({
      '/project/index.ts': 'const x = 1;\nconst y = 2;',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(0);
  });

  it('detects port from ports/ subdirectory', async () => {
    const fs = new InMemoryFileSystem({
      '/project/ports/my-port.ts': 'export interface MyPort { execute(): Promise<void>; }',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    const portPart = parts.find(p => p.part === 'port');
    expect(portPart).toBeDefined();
    expect(portPart!.filePath).toBe('/project/ports/my-port.ts');
  });

  it('detects port from *port.ts filename', async () => {
    const fs = new InMemoryFileSystem({
      '/project/my-port.ts': 'export interface MyPort { execute(): Promise<void>; }',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(1);
    expect(parts[0].part).toBe('port');
  });

  it('detects verification from *.test.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/my-service.test.ts': 'import { describe, it } from "vitest"; describe("test", () => { it("works", () => {}); });',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(1);
    expect(parts[0].part).toBe('verification');
    expect(parts[0].filePath).toBe('/project/my-service.test.ts');
  });

  it('detects verification from *.spec.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/my-service.spec.ts': 'describe("spec", () => {});',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts[0].part).toBe('verification');
  });

  it('detects observability from *.metrics.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/my-service.metrics.ts': 'export const requestCounter = 0;',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(1);
    expect(parts[0].part).toBe('observability');
  });

  it('detects observability from *.observability.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/my-service.observability.ts': 'export const metrics = {};',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts[0].part).toBe('observability');
  });

  it('detects architecture from architecture.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/architecture.ts': 'export const arch = "layered";',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts[0].part).toBe('architecture');
  });

  it('detects domain from *-domain.ts', async () => {
    const fs = new InMemoryFileSystem({
      '/project/session-domain.ts': 'export class SessionDomain {}',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts[0].part).toBe('domain');
  });

  it('detects multiple parts in one directory', async () => {
    const fs = new InMemoryFileSystem({
      '/project/README.md': '# Component\n\nDescription.',
      '/project/index.ts': 'export interface Foo {}',
      '/project/foo.test.ts': 'describe("foo", () => {});',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    const partNames = parts.map(p => p.part);
    expect(partNames).toContain('documentation');
    expect(partNames).toContain('interface');
    expect(partNames).toContain('verification');
  });

  it('returns empty array for directory with no matching files', async () => {
    const fs = new InMemoryFileSystem({
      '/project/utils.ts': 'const x = 1;',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    expect(parts).toHaveLength(0);
  });

  it('does not duplicate parts (first match wins)', async () => {
    const fs = new InMemoryFileSystem({
      '/project/README.md': '# Component',
      '/project/guide.md': '# Guide',
    });
    const detector = new FcaDetector(fs);
    const parts = await detector.detect('/project', {});

    const docParts = parts.filter(p => p.part === 'documentation');
    expect(docParts).toHaveLength(1);
  });
});
