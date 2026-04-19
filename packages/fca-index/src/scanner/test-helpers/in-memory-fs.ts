// SPDX-License-Identifier: Apache-2.0
/**
 * InMemoryFileSystem — Test helper implementing FileSystemPort backed by a plain object tree.
 *
 * Usage:
 *   const fs = new InMemoryFileSystem({
 *     '/project/src/index.ts': 'export interface Foo {}',
 *     '/project/README.md': '# My Project\n\nThis is my project.',
 *   });
 */

import type { FileSystemPort, DirEntry } from '../../ports/internal/file-system.js';

export class InMemoryFileSystem implements FileSystemPort {
  private readonly files: Map<string, string>;
  /** Optional per-path mtime overrides for freshness testing. Defaults to 0. */
  private readonly mtimes: Map<string, number>;

  constructor(tree: Record<string, string>, mtimes: Record<string, number> = {}) {
    this.files = new Map(Object.entries(tree));
    this.mtimes = new Map(Object.entries(mtimes));
  }

  async readFile(path: string, _encoding: 'utf-8'): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`InMemoryFileSystem: file not found: ${path}`);
    }
    return content;
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const normalizedDir = path.endsWith('/') ? path.slice(0, -1) : path;
    const entries = new Map<string, DirEntry>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(normalizedDir + '/')) continue;

      const rest = filePath.slice(normalizedDir.length + 1);
      const slashIdx = rest.indexOf('/');

      if (slashIdx === -1) {
        // Direct child file
        const name = rest;
        if (!entries.has(name)) {
          entries.set(name, {
            name,
            isDirectory: false,
            path: filePath,
          });
        }
      } else {
        // Child directory
        const name = rest.slice(0, slashIdx);
        const dirPath = normalizedDir + '/' + name;
        if (!entries.has(name)) {
          entries.set(name, {
            name,
            isDirectory: true,
            path: dirPath,
          });
        }
      }
    }

    return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;

    // Check if it's a directory (any file starts with path + '/')
    const prefix = path.endsWith('/') ? path : path + '/';
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  }

  async getModifiedTime(path: string): Promise<number> {
    return this.mtimes.get(path) ?? 0;
  }

  async glob(pattern: string, root: string, options?: { ignore?: string[] }): Promise<string[]> {
    // Simple glob implementation supporting ** and * wildcards
    const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
    const regex = globToRegex(pattern, normalizedRoot);
    const ignoreRegexes = (options?.ignore ?? []).map(p => globToRegex(p, normalizedRoot));

    return Array.from(this.files.keys())
      .filter(p => regex.test(p) && !ignoreRegexes.some(ir => ir.test(p)))
      .sort();
  }
}

/**
 * Convert a glob pattern (relative to root) into a RegExp that matches absolute paths.
 */
function globToRegex(pattern: string, root: string): RegExp {
  const fullPattern = root + '/' + pattern;

  // Escape regex special chars, then replace glob wildcards
  const escaped = fullPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');

  return new RegExp('^' + escaped + '$');
}
