/**
 * FileSystemService — Effect Layer for file system operations.
 *
 * Provides a testable abstraction over Node.js fs operations (read, glob, stat, exists, readDir).
 * Live implementation uses fs/promises; the test layer supports an in-memory filesystem
 * for deterministic testing.
 *
 * PRD Component 8: Extractor framework — service layer.
 * DR-T02: Effect is the primary side-effect mechanism.
 */

import { Context, Effect, Layer } from "effect";

/**
 * Error produced when a filesystem operation fails.
 *
 * Captures the operation name, the path involved, a human-readable message,
 * and optionally the underlying cause.
 */
export type FileSystemError = {
  readonly _tag: "FileSystemError";
  readonly operation: string;
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Result of a stat operation.
 *
 * Provides size, type flags, and modification timestamp.
 */
export type StatResult = {
  readonly size: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly modifiedAt: Date;
};

/**
 * Service interface for filesystem operations.
 *
 * All file system interaction in the extractor framework goes through this service,
 * enabling both live execution and deterministic test mocks.
 */
export interface FileSystemService {
  /** Read a file as a UTF-8 string. */
  readonly readFile: (path: string) => Effect.Effect<string, FileSystemError, never>;
  /** Read a file as a raw Buffer. */
  readonly readFileBuffer: (path: string) => Effect.Effect<Buffer, FileSystemError, never>;
  /** Glob for files matching a pattern, optionally rooted at cwd. */
  readonly glob: (pattern: string, cwd?: string) => Effect.Effect<string[], FileSystemError, never>;
  /** Stat a file, returning size, type flags, and modification time. */
  readonly stat: (path: string) => Effect.Effect<StatResult, FileSystemError, never>;
  /** Check whether a path exists. Never fails. */
  readonly exists: (path: string) => Effect.Effect<boolean, never, never>;
  /** List entries in a directory. */
  readonly readDir: (path: string) => Effect.Effect<string[], FileSystemError, never>;
}

/**
 * Effect Context tag for FileSystemService.
 *
 * Used in Layer composition to provide/require FileSystemService.
 */
export const FileSystemService = Context.GenericTag<FileSystemService>("FileSystemService");

/**
 * Live implementation of FileSystemService using Node.js fs module.
 */
export const FileSystemServiceLive = Layer.succeed(FileSystemService, {
  readFile: (path) =>
    Effect.tryPromise({
      try: async () => {
        const { readFile } = await import("fs/promises");
        return readFile(path, "utf-8");
      },
      catch: (e) => ({
        _tag: "FileSystemError" as const,
        operation: "readFile",
        path,
        message: String(e),
        cause: e,
      }),
    }),

  readFileBuffer: (path) =>
    Effect.tryPromise({
      try: async () => {
        const { readFile } = await import("fs/promises");
        return readFile(path);
      },
      catch: (e) => ({
        _tag: "FileSystemError" as const,
        operation: "readFileBuffer",
        path,
        message: String(e),
        cause: e,
      }),
    }),

  glob: (pattern, cwd) =>
    Effect.tryPromise({
      try: async () => {
        const { readdir } = await import("fs/promises");
        const { join } = await import("path");
        // Simple implementation: list directory entries and filter.
        // For Phase 2, a proper glob library can be wired in.
        const dir = cwd ?? ".";
        const entries = await readdir(dir, { recursive: true });
        // Return all entries as string[] — glob filtering deferred to Phase 2.
        return entries.map((e) => (typeof e === "string" ? e : join(String(e))));
      },
      catch: (e) => ({
        _tag: "FileSystemError" as const,
        operation: "glob",
        path: pattern,
        message: String(e),
        cause: e,
      }),
    }),

  stat: (path) =>
    Effect.tryPromise({
      try: async () => {
        const { stat } = await import("fs/promises");
        const s = await stat(path);
        return {
          size: s.size,
          isDirectory: s.isDirectory(),
          isFile: s.isFile(),
          modifiedAt: s.mtime,
        };
      },
      catch: (e) => ({
        _tag: "FileSystemError" as const,
        operation: "stat",
        path,
        message: String(e),
        cause: e,
      }),
    }),

  exists: (path) =>
    Effect.tryPromise({
      try: async () => {
        const { access } = await import("fs/promises");
        await access(path);
        return true;
      },
      catch: () => ({
        _tag: "FileSystemError" as const,
        operation: "exists",
        path,
        message: "access check failed",
      }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  readDir: (path) =>
    Effect.tryPromise({
      try: async () => {
        const { readdir } = await import("fs/promises");
        const entries = await readdir(path);
        return entries;
      },
      catch: (e) => ({
        _tag: "FileSystemError" as const,
        operation: "readDir",
        path,
        message: String(e),
        cause: e,
      }),
    }),
});

/**
 * Test implementation of FileSystemService with an in-memory filesystem.
 *
 * Provides deterministic behavior for testing: files are stored as a
 * Record<string, string> mapping from path to content.
 *
 * @param files - Map from file path to file content
 * @returns A Layer providing FileSystemService with mock behavior
 */
export const FileSystemServiceTest = (files: Record<string, string>) =>
  Layer.succeed(FileSystemService, {
    readFile: (path) => {
      const content = files[path];
      if (content !== undefined) return Effect.succeed(content);
      return Effect.fail({
        _tag: "FileSystemError" as const,
        operation: "readFile",
        path,
        message: "File not found",
      });
    },

    readFileBuffer: (path) => {
      const content = files[path];
      if (content !== undefined) return Effect.succeed(Buffer.from(content));
      return Effect.fail({
        _tag: "FileSystemError" as const,
        operation: "readFileBuffer",
        path,
        message: "File not found",
      });
    },

    glob: (_pattern, _cwd) => Effect.succeed(Object.keys(files)),

    stat: (path) => {
      const content = files[path];
      if (content !== undefined)
        return Effect.succeed({
          size: content.length,
          isDirectory: false,
          isFile: true,
          modifiedAt: new Date("2026-01-01T00:00:00Z"),
        });
      return Effect.fail({
        _tag: "FileSystemError" as const,
        operation: "stat",
        path,
        message: "File not found",
      });
    },

    exists: (path) => Effect.succeed(path in files),

    readDir: (path) => {
      // Return keys that start with the given path, stripped to the relative portion.
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries = Object.keys(files)
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length))
        .filter((f) => !f.includes("/"));
      return Effect.succeed(entries);
    },
  });
