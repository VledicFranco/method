// SPDX-License-Identifier: Apache-2.0
/**
 * DocExtractor — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { DocExtractor } from './doc-extractor.js';
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';

describe('DocExtractor', () => {
  describe('README.md extraction', () => {
    it('extracts first paragraph from README.md', async () => {
      const fs = new InMemoryFileSystem({
        '/project/README.md': '# My Component\n\nThis is the first paragraph.\n\nThis is the second paragraph.',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/README.md', 'documentation');

      expect(excerpt).toBe('# My Component');
    });

    it('extracts first paragraph including multi-line', async () => {
      const fs = new InMemoryFileSystem({
        '/project/README.md': '# My Component\nLine two of heading section\n\nSecond paragraph.',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/README.md', 'documentation');

      expect(excerpt).toBe('# My Component\nLine two of heading section');
    });

    it('trims excerpt to ≤ 600 chars', async () => {
      const longLine = 'A'.repeat(800);
      const fs = new InMemoryFileSystem({
        '/project/README.md': longLine,
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/README.md', 'documentation');

      expect(excerpt.length).toBeLessThanOrEqual(600);
    });

    it('handles .md files other than README.md', async () => {
      const fs = new InMemoryFileSystem({
        '/project/guide.md': '## Guide\n\nThis is the guide content.',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/guide.md', 'documentation');

      expect(excerpt).toBe('## Guide');
    });
  });

  describe('index.ts interface extraction', () => {
    it('extracts exported signatures from index.ts', async () => {
      const fs = new InMemoryFileSystem({
        '/project/index.ts': [
          'import { Foo } from "./foo.js";',
          '',
          'export interface Bar { baz(): void; }',
          'export type Id = string;',
          'export function create(): Bar { return {} as Bar; }',
          '',
          'const internal = 42;',
        ].join('\n'),
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/index.ts', 'interface');

      expect(excerpt).toContain('export interface Bar');
      expect(excerpt).toContain('export type Id');
      expect(excerpt).toContain('export function create');
      expect(excerpt).not.toContain('import');
      expect(excerpt).not.toContain('internal');
    });

    it('falls back to first 600 chars when no exports found', async () => {
      const fs = new InMemoryFileSystem({
        '/project/index.ts': 'const x = 1;\nconst y = 2;\n',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/index.ts', 'interface');

      expect(excerpt).toContain('const x');
    });
  });

  describe('JSDoc extraction for TS files', () => {
    it('extracts JSDoc block from top of TS file', async () => {
      const fs = new InMemoryFileSystem({
        '/project/my-service.ts': '/**\n * Service description.\n * @param x - the input\n */\nexport class MyService {}',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/my-service.ts', 'port');

      expect(excerpt).toContain('Service description');
    });

    it('falls back to first 600 chars when no JSDoc found', async () => {
      const fs = new InMemoryFileSystem({
        '/project/my-service.ts': 'export class MyService { constructor() {} }',
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/my-service.ts', 'port');

      expect(excerpt).toContain('export class MyService');
    });
  });

  describe('fallback behavior', () => {
    it('returns first 600 chars of content when no pattern matches', async () => {
      const content = 'Hello world content here.';
      const fs = new InMemoryFileSystem({
        '/project/random.ts': content,
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/random.ts', 'verification');

      expect(excerpt).toBe('Hello world content here.');
    });

    it('never exceeds 600 chars in any path', async () => {
      const content = 'A'.repeat(1000);
      const fs = new InMemoryFileSystem({
        '/project/big.ts': content,
      });
      const extractor = new DocExtractor(fs);
      const excerpt = await extractor.extract('/project/big.ts', 'verification');

      expect(excerpt.length).toBeLessThanOrEqual(600);
    });
  });
});
