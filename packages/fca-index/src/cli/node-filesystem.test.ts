// SPDX-License-Identifier: Apache-2.0
/**
 * NodeFileSystem — integration tests against real fixture directories.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from './node-filesystem.js';

// Resolve the fixture path relative to this test file.
// Using URL constructor because import.meta.url gives us a reliable absolute path.
const fixtureDir = new URL('../../tests/fixtures/sample-fca-l2-domain', import.meta.url).pathname
  // On Windows, the pathname includes a leading slash before the drive letter — strip it.
  .replace(/^\/([A-Z]:)/, '$1');

const fs = new NodeFileSystem();

describe('NodeFileSystem', () => {
  it('readFile reads a known fixture file', async () => {
    const content = await fs.readFile(`${fixtureDir}/index.ts`, 'utf-8');
    expect(content).toContain('SampleDomain');
  });

  it('readDir lists directory entries including files and directories', async () => {
    const entries = await fs.readDir(fixtureDir);

    expect(entries.length).toBeGreaterThan(0);

    const names = entries.map((e) => e.name);
    expect(names).toContain('index.ts');
    expect(names).toContain('README.md');

    // All entries have the required DirEntry fields
    for (const entry of entries) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.isDirectory).toBe('boolean');
      expect(typeof entry.path).toBe('string');
      expect(entry.path).toContain(entry.name);
    }

    // index.ts is a file, not a directory
    const indexEntry = entries.find((e) => e.name === 'index.ts');
    expect(indexEntry?.isDirectory).toBe(false);
  });

  it('exists returns true for an existing path', async () => {
    const result = await fs.exists(`${fixtureDir}/index.ts`);
    expect(result).toBe(true);
  });

  it('exists returns false for a nonexistent path', async () => {
    const result = await fs.exists(`${fixtureDir}/does-not-exist.ts`);
    expect(result).toBe(false);
  });

  it('glob finds .ts files in the fixture directory', async () => {
    const files = await fs.glob('**/*.ts', fixtureDir);

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.endsWith('.ts')).toBe(true);
    }

    // Should find the index.ts we know is there
    const hasIndexTs = files.some((f) => f.endsWith('index.ts'));
    expect(hasIndexTs).toBe(true);
  });

  it('glob returns absolute paths', async () => {
    const files = await fs.glob('*.ts', fixtureDir);
    for (const f of files) {
      // An absolute path starts with / on Unix or a drive letter on Windows.
      // fast-glob normalizes Windows paths to forward slashes (C:/...), so we
      // accept both C:\ and C:/ forms.
      expect(f).toMatch(/^(\/|[A-Z]:[/\\])/i);
    }
  });
});
