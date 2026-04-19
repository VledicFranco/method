// SPDX-License-Identifier: Apache-2.0
/**
 * FileSystemProvider — Port interface for filesystem operations.
 *
 * PRD-057 / S2 §5.3: Only the interface lives in runtime. The Node impl
 * (`NodeFileSystemProvider`) stays in bridge because it binds directly to
 * `node:fs` — an OS-transport dependency runtime cannot take.
 */

// ── Port interface ──────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface FileStat {
  mtimeMs: number;
  mtime: Date;
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FileSystemProvider {
  // ── Synchronous methods ──
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, content: string, options?: { encoding?: BufferEncoding; mode?: number }): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  statSync(path: string): FileStat;
  unlinkSync(path: string): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  renameSync(oldPath: string, newPath: string): void;
  realpathSync(path: string): string;

  // ── Async methods (PRD 024: for domains using fs/promises) ──
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string, encoding: BufferEncoding): Promise<void>;
  appendFile(path: string, content: string, encoding: BufferEncoding): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}
