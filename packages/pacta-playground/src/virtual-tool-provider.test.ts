// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualToolProvider } from './virtual-tool-provider.js';

describe('VirtualToolProvider', () => {
  // ── Read ─────────────────────────────────────────────────────

  describe('Read', () => {
    it('reads an existing file with line numbers', async () => {
      const vfs = new VirtualToolProvider({ '/src/main.ts': 'line1\nline2\nline3' });
      const result = await vfs.execute('Read', { file_path: '/src/main.ts' });
      assert.equal(result.isError, undefined);
      const output = result.output as string;
      assert.ok(output.includes('1\tline1'));
      assert.ok(output.includes('2\tline2'));
      assert.ok(output.includes('3\tline3'));
    });

    it('returns error for missing file', async () => {
      const vfs = new VirtualToolProvider();
      const result = await vfs.execute('Read', { file_path: '/missing.ts' });
      assert.equal(result.isError, true);
      assert.ok((result.output as string).includes('not found'));
    });

    it('respects offset and limit', async () => {
      const vfs = new VirtualToolProvider({
        '/file.txt': 'a\nb\nc\nd\ne',
      });
      const result = await vfs.execute('Read', { file_path: '/file.txt', offset: 1, limit: 2 });
      const output = result.output as string;
      assert.ok(output.includes('b'));
      assert.ok(output.includes('c'));
      assert.ok(!output.includes('\ta\n'));
      assert.ok(!output.includes('d'));
    });

    it('returns error when file_path is missing', async () => {
      const vfs = new VirtualToolProvider();
      const result = await vfs.execute('Read', {});
      assert.equal(result.isError, true);
    });
  });

  // ── Write ────────────────────────────────────────────────────

  describe('Write', () => {
    it('creates a new file', async () => {
      const vfs = new VirtualToolProvider();
      const result = await vfs.execute('Write', {
        file_path: '/new.ts',
        content: 'export const x = 1;',
      });
      assert.equal(result.isError, undefined);
      assert.equal(vfs.getFile('/new.ts'), 'export const x = 1;');
    });

    it('overwrites an existing file', async () => {
      const vfs = new VirtualToolProvider({ '/file.ts': 'old' });
      await vfs.execute('Write', { file_path: '/file.ts', content: 'new' });
      assert.equal(vfs.getFile('/file.ts'), 'new');
    });

    it('returns error for missing params', async () => {
      const vfs = new VirtualToolProvider();
      const r1 = await vfs.execute('Write', { content: 'x' });
      assert.equal(r1.isError, true);
      const r2 = await vfs.execute('Write', { file_path: '/a.ts' });
      assert.equal(r2.isError, true);
    });
  });

  // ── Edit ─────────────────────────────────────────────────────

  describe('Edit', () => {
    it('replaces a unique string', async () => {
      const vfs = new VirtualToolProvider({ '/f.ts': 'const x = 1;\nconst y = 2;' });
      const result = await vfs.execute('Edit', {
        file_path: '/f.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 42;',
      });
      assert.equal(result.isError, undefined);
      assert.equal(vfs.getFile('/f.ts'), 'const x = 42;\nconst y = 2;');
    });

    it('errors on non-unique old_string without replace_all', async () => {
      const vfs = new VirtualToolProvider({ '/f.ts': 'foo\nfoo' });
      const result = await vfs.execute('Edit', {
        file_path: '/f.ts',
        old_string: 'foo',
        new_string: 'bar',
      });
      assert.equal(result.isError, true);
      assert.ok((result.output as string).includes('not unique'));
    });

    it('replace_all replaces all occurrences', async () => {
      const vfs = new VirtualToolProvider({ '/f.ts': 'foo\nfoo' });
      const result = await vfs.execute('Edit', {
        file_path: '/f.ts',
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      });
      assert.equal(result.isError, undefined);
      assert.equal(vfs.getFile('/f.ts'), 'bar\nbar');
    });

    it('errors when old_string not found', async () => {
      const vfs = new VirtualToolProvider({ '/f.ts': 'hello' });
      const result = await vfs.execute('Edit', {
        file_path: '/f.ts',
        old_string: 'world',
        new_string: 'x',
      });
      assert.equal(result.isError, true);
    });

    it('errors for missing file', async () => {
      const vfs = new VirtualToolProvider();
      const result = await vfs.execute('Edit', {
        file_path: '/missing.ts',
        old_string: 'a',
        new_string: 'b',
      });
      assert.equal(result.isError, true);
    });
  });

  // ── Glob ─────────────────────────────────────────────────────

  describe('Glob', () => {
    it('matches files by glob pattern', async () => {
      const vfs = new VirtualToolProvider({
        '/src/a.ts': '',
        '/src/b.ts': '',
        '/src/c.js': '',
        '/docs/readme.md': '',
      });
      const result = await vfs.execute('Glob', { pattern: '**/*.ts' });
      const output = result.output as string;
      assert.ok(output.includes('/src/a.ts'));
      assert.ok(output.includes('/src/b.ts'));
      assert.ok(!output.includes('/src/c.js'));
    });

    it('returns no matches message for empty result', async () => {
      const vfs = new VirtualToolProvider({ '/a.txt': '' });
      const result = await vfs.execute('Glob', { pattern: '*.xyz' });
      assert.equal(result.output, '(no matches)');
    });
  });

  // ── Grep ─────────────────────────────────────────────────────

  describe('Grep', () => {
    it('finds matching lines (content mode)', async () => {
      const vfs = new VirtualToolProvider({
        '/src/a.ts': 'import foo from "bar";\nexport const x = 1;',
        '/src/b.ts': 'const y = 2;',
      });
      const result = await vfs.execute('Grep', {
        pattern: 'const',
        output_mode: 'content',
      });
      const output = result.output as string;
      assert.ok(output.includes('const x = 1'));
      assert.ok(output.includes('const y = 2'));
    });

    it('returns matching files (files_with_matches mode)', async () => {
      const vfs = new VirtualToolProvider({
        '/a.ts': 'hello world',
        '/b.ts': 'goodbye',
        '/c.ts': 'hello again',
      });
      const result = await vfs.execute('Grep', {
        pattern: 'hello',
        output_mode: 'files_with_matches',
      });
      const output = result.output as string;
      assert.ok(output.includes('/a.ts'));
      assert.ok(output.includes('/c.ts'));
      assert.ok(!output.includes('/b.ts'));
    });

    it('returns match counts (count mode)', async () => {
      const vfs = new VirtualToolProvider({
        '/a.ts': 'foo\nfoo\nbar',
        '/b.ts': 'foo',
      });
      const result = await vfs.execute('Grep', {
        pattern: 'foo',
        output_mode: 'count',
      });
      const output = result.output as string;
      assert.ok(output.includes('/a.ts:2'));
      assert.ok(output.includes('/b.ts:1'));
    });

    it('returns error for invalid regex', async () => {
      const vfs = new VirtualToolProvider({ '/a.ts': 'test' });
      const result = await vfs.execute('Grep', { pattern: '[invalid' });
      assert.equal(result.isError, true);
    });
  });

  // ── Unknown tool ─────────────────────────────────────────────

  describe('Unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const vfs = new VirtualToolProvider();
      const result = await vfs.execute('Shell', { command: 'ls' });
      assert.equal(result.isError, true);
    });
  });

  // ── Call log ─────────────────────────────────────────────────

  describe('Call log', () => {
    it('records all calls', async () => {
      const vfs = new VirtualToolProvider({ '/a.ts': 'hello' });
      await vfs.execute('Read', { file_path: '/a.ts' });
      await vfs.execute('Write', { file_path: '/b.ts', content: 'world' });
      assert.equal(vfs.callLog.length, 2);
      assert.equal(vfs.callLog[0].name, 'Read');
      assert.equal(vfs.callLog[1].name, 'Write');
    });
  });

  // ── list() ───────────────────────────────────────────────────

  describe('list()', () => {
    it('returns all supported tools', () => {
      const vfs = new VirtualToolProvider();
      const defs = vfs.list();
      const names = defs.map(d => d.name);
      assert.deepEqual(names.sort(), ['Edit', 'Glob', 'Grep', 'Read', 'Write']);
    });
  });

  // ── Path normalization ───────────────────────────────────────

  describe('Path normalization', () => {
    it('normalizes backslashes to forward slashes', async () => {
      const vfs = new VirtualToolProvider({ 'C:\\Users\\test\\file.ts': 'content' });
      const result = await vfs.execute('Read', { file_path: 'C:/Users/test/file.ts' });
      assert.equal(result.isError, undefined);
    });
  });
});
