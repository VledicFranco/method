import {
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync,
  existsSync as nodeExistsSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
  unlinkSync as nodeUnlinkSync,
  mkdirSync as nodeMkdirSync,
  renameSync as nodeRenameSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs';
import {
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  stat as nodeStat,
  access as nodeAccess,
  mkdir as nodeMkdir,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';

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
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

// ── Production implementation ───────────────────────────────────

export class NodeFileSystemProvider implements FileSystemProvider {
  readFileSync(path: string, encoding: BufferEncoding): string {
    return nodeReadFileSync(path, encoding);
  }

  writeFileSync(path: string, content: string, options?: { encoding?: BufferEncoding; mode?: number }): void {
    nodeWriteFileSync(path, content, options);
  }

  existsSync(path: string): boolean {
    return nodeExistsSync(path);
  }

  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    if (options?.withFileTypes) {
      return nodeReaddirSync(path, { withFileTypes: true });
    }
    return nodeReaddirSync(path);
  }

  statSync(path: string): FileStat {
    return nodeStatSync(path);
  }

  unlinkSync(path: string): void {
    nodeUnlinkSync(path);
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    nodeMkdirSync(path, options);
  }

  renameSync(oldPath: string, newPath: string): void {
    nodeRenameSync(oldPath, newPath);
  }

  realpathSync(path: string): string {
    return nodeRealpathSync(path);
  }

  // ── Async methods ──

  async readFile(path: string, encoding: BufferEncoding): Promise<string> {
    return nodeReadFile(path, encoding);
  }

  async writeFile(path: string, content: string, encoding: BufferEncoding): Promise<void> {
    await nodeWriteFile(path, content, encoding);
  }

  async readdir(path: string): Promise<string[]> {
    return nodeReaddir(path);
  }

  async stat(path: string): Promise<FileStat> {
    return nodeStat(path);
  }

  async access(path: string): Promise<void> {
    return nodeAccess(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await nodeMkdir(path, options);
  }
}
