/**
 * NodeFileSystem — real FileSystemPort adapter for production use.
 *
 * Implements FileSystemPort using node:fs/promises and fast-glob.
 * This is the infrastructure layer adapter — it is the only place in the
 * fca-index library that imports node:fs directly.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import type { FileSystemPort, DirEntry } from '../ports/internal/file-system.js';

export class NodeFileSystem implements FileSystemPort {
  async readFile(path: string, encoding: 'utf-8'): Promise<string> {
    return readFile(path, encoding);
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: join(path, e.name),
    }));
  }

  async exists(path: string): Promise<boolean> {
    return access(path).then(
      () => true,
      () => false,
    );
  }

  async glob(pattern: string, root: string): Promise<string[]> {
    return fg(pattern, { cwd: root, absolute: true, dot: false });
  }
}
