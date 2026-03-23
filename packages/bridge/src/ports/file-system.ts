import {
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync,
  existsSync as nodeExistsSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
  unlinkSync as nodeUnlinkSync,
} from 'node:fs';

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
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, content: string, options?: { encoding?: BufferEncoding; mode?: number }): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  statSync(path: string): FileStat;
  unlinkSync(path: string): void;
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
}
