// SPDX-License-Identifier: Apache-2.0
/**
 * FileSystemService tests.
 *
 * Validates: FileSystemServiceTest (in-memory mock), FileSystemServiceLive (real fs),
 * error construction, Layer composition.
 *
 * PRD Component 8: Extractor framework — service layer.
 */

import { describe, it, expect } from "vitest";
import { Effect, pipe } from "effect";
import {
  FileSystemService,
  FileSystemServiceTest,
  FileSystemServiceLive,
} from "../services/filesystem.js";
import type { FileSystemError } from "../services/filesystem.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "..", "..", "..", "package.json");

// ── In-memory test layer ──

const testFiles: Record<string, string> = {
  "/project/README.md": "# Hello World",
  "/project/src/index.ts": "export const x = 1;",
  "/project/src/util.ts": "export function add(a: number, b: number) { return a + b; }",
  "/project/package.json": '{"name": "test"}',
};

const testLayer = FileSystemServiceTest(testFiles);

describe("FileSystemServiceTest — readFile", () => {
  it("returns content for known path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readFile("/project/README.md")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("# Hello World");
  });

  it("fails for unknown path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readFile("/missing/file.txt")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as FileSystemError;
      expect(err._tag).toBe("FileSystemError");
      expect(err.operation).toBe("readFile");
      expect(err.path).toBe("/missing/file.txt");
      expect(err.message).toBe("File not found");
    }
  });
});

describe("FileSystemServiceTest — readFileBuffer", () => {
  it("returns Buffer for known path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readFileBuffer("/project/README.md")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString("utf-8")).toBe("# Hello World");
  });

  it("fails for unknown path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readFileBuffer("/nope")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as FileSystemError;
      expect(err._tag).toBe("FileSystemError");
      expect(err.operation).toBe("readFileBuffer");
    }
  });
});

describe("FileSystemServiceTest — exists", () => {
  it("returns true for known path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.exists("/project/README.md")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe(true);
  });

  it("returns false for unknown path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.exists("/does/not/exist")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe(false);
  });
});

describe("FileSystemServiceTest — stat", () => {
  it("returns size and flags for known path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.stat("/project/README.md")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result.size).toBe("# Hello World".length);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
    expect(result.modifiedAt).toBeInstanceOf(Date);
  });

  it("fails for unknown path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.stat("/nope")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as FileSystemError;
      expect(err._tag).toBe("FileSystemError");
      expect(err.operation).toBe("stat");
      expect(err.path).toBe("/nope");
    }
  });
});

describe("FileSystemServiceTest — readDir", () => {
  it("returns direct children of a directory path", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readDir("/project/src")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toContain("index.ts");
    expect(result).toContain("util.ts");
  });

  it("returns empty array for path with no children", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readDir("/empty")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toEqual([]);
  });
});

describe("FileSystemServiceTest — glob", () => {
  it("returns all keys from the in-memory filesystem", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.glob("**/*")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toEqual(Object.keys(testFiles));
    expect(result).toHaveLength(4);
  });
});

// ── Live implementation ──

describe("FileSystemServiceLive — readFile", () => {
  it("reads an actual file (package.json as fixture)", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.readFile(packageJsonPath)),
      Effect.provide(FileSystemServiceLive),
    );

    const result = await Effect.runPromise(program);
    expect(result).toContain('"name"');
    expect(result).toContain("@methodts/methodts");
  });

  it("fails for a non-existent file", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) =>
        svc.readFile("/definitely/does/not/exist.txt"),
      ),
      Effect.provide(FileSystemServiceLive),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as FileSystemError;
      expect(err._tag).toBe("FileSystemError");
      expect(err.operation).toBe("readFile");
    }
  });
});

describe("FileSystemServiceLive — stat", () => {
  it("stats an actual file", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.stat(packageJsonPath)),
      Effect.provide(FileSystemServiceLive),
    );

    const result = await Effect.runPromise(program);
    expect(result.size).toBeGreaterThan(0);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
    expect(result.modifiedAt).toBeInstanceOf(Date);
  });
});

describe("FileSystemServiceLive — exists", () => {
  it("returns true for an existing file", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) => svc.exists(packageJsonPath)),
      Effect.provide(FileSystemServiceLive),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe(true);
  });

  it("returns false for a non-existent file", async () => {
    const program = pipe(
      Effect.flatMap(FileSystemService, (svc) =>
        svc.exists("/definitely/does/not/exist.txt"),
      ),
      Effect.provide(FileSystemServiceLive),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe(false);
  });
});

// ── Error construction ──

describe("FileSystemError construction", () => {
  it("constructs a well-formed error with all fields", () => {
    const err: FileSystemError = {
      _tag: "FileSystemError",
      operation: "readFile",
      path: "/some/path",
      message: "Permission denied",
      cause: new Error("EACCES"),
    };
    expect(err._tag).toBe("FileSystemError");
    expect(err.operation).toBe("readFile");
    expect(err.path).toBe("/some/path");
    expect(err.message).toBe("Permission denied");
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("constructs an error without optional cause", () => {
    const err: FileSystemError = {
      _tag: "FileSystemError",
      operation: "stat",
      path: "/other/path",
      message: "File not found",
    };
    expect(err._tag).toBe("FileSystemError");
    expect(err.cause).toBeUndefined();
  });
});
