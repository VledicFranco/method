// SPDX-License-Identifier: Apache-2.0
/**
 * FileSystemPort — Internal port isolating scanner domain from node:fs.
 *
 * Owner: @methodts/fca-index (defines interface + provides NodeFileSystem impl)
 * Consumer: scanner domain (internal)
 * Direction: filesystem → scanner (unidirectional)
 * Status: frozen 2026-04-10 (extended from 2026-04-08; see fcd-surface-fca-index-internal-ports-ext)
 */

export interface FileSystemPort {
  /** Read file contents as utf-8 string. */
  readFile(path: string, encoding: 'utf-8'): Promise<string>;

  /** List directory entries. */
  readDir(path: string): Promise<DirEntry[]>;

  /** Check if a path exists. */
  exists(path: string): Promise<boolean>;

  /**
   * Resolve glob pattern relative to root.
   * Returns absolute paths sorted lexicographically.
   * @param options.ignore - Glob patterns to exclude from results (relative to root).
   */
  glob(pattern: string, root: string, options?: { ignore?: string[] }): Promise<string[]>;

  /**
   * Get the last modified time of a path, in milliseconds since Unix epoch.
   * Added 2026-04-09; formalized in fcd-surface-fca-index-internal-ports-ext (2026-04-10).
   */
  getModifiedTime(path: string): Promise<number>;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  /** Absolute path to this entry. */
  path: string;
}

export class FileSystemError extends Error {
  constructor(message: string, public readonly code: 'READ_FAILED' | 'NOT_FOUND' | 'PERMISSION_DENIED') {
    super(message);
    this.name = 'FileSystemError';
  }
}
