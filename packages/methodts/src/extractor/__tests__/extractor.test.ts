// SPDX-License-Identifier: Apache-2.0
/**
 * Extractor framework tests.
 *
 * Validates: Extractor type alias, CommandService (mock/error),
 * GitService (log, diff, branch, status, error mapping),
 * Layer composition (GitServiceLive + CommandServiceTest).
 *
 * PRD Component 8: Extractor framework.
 */

import { describe, it, expect } from "vitest";
import { Effect, Layer, pipe } from "effect";
import type { Extractor, ExtractionError } from "../extractor.js";
import {
  CommandService,
  CommandServiceLive,
  CommandServiceTest,
} from "../services/command.js";
import type { CommandError } from "../services/command.js";
import { GitService, GitServiceLive } from "../services/git.js";
import type { GitError } from "../services/git.js";

// ── Extractor type alias ──

describe("Extractor type alias", () => {
  it("can assign Effect.succeed to Extractor<string>", () => {
    const ext: Extractor<string> = Effect.succeed("hello");
    expect(ext).toBeDefined();
  });

  it("can assign Effect.fail with ExtractionError to Extractor<string>", () => {
    const err: ExtractionError = {
      _tag: "ExtractionError",
      key: "test-key",
      message: "something went wrong",
    };
    const ext: Extractor<string> = Effect.fail(err);
    expect(ext).toBeDefined();
  });

  it("resolves the value when run", async () => {
    const ext: Extractor<number> = Effect.succeed(42);
    const result = await Effect.runPromise(ext);
    expect(result).toBe(42);
  });
});

// ── CommandService mock ──

describe("CommandService — mock (CommandServiceTest)", () => {
  it("returns configured response for exact command+args key", async () => {
    const layer = CommandServiceTest({
      "git log --oneline -5": { stdout: "abc123 first commit\ndef456 second commit", exitCode: 0 },
    });

    const program = pipe(
      Effect.flatMap(CommandService, (svc) => svc.exec("git", ["log", "--oneline", "-5"])),
      Effect.provide(layer),
    );

    const result = await Effect.runPromise(program);
    expect(result.stdout).toBe("abc123 first commit\ndef456 second commit");
    expect(result.exitCode).toBe(0);
  });

  it("falls back to command-only key when no full key matches", async () => {
    const layer = CommandServiceTest({
      git: { stdout: "fallback output", exitCode: 0 },
    });

    const program = pipe(
      Effect.flatMap(CommandService, (svc) => svc.exec("git", ["status"])),
      Effect.provide(layer),
    );

    const result = await Effect.runPromise(program);
    expect(result.stdout).toBe("fallback output");
  });

  it("returns CommandError for unknown command", async () => {
    const layer = CommandServiceTest({});

    const program = pipe(
      Effect.flatMap(CommandService, (svc) => svc.exec("unknown-cmd", ["--flag"])),
      Effect.provide(layer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as CommandError;
      expect(err._tag).toBe("CommandError");
      expect(err.command).toBe("unknown-cmd");
      expect(err.message).toContain("No mock response for");
    }
  });
});

describe("CommandService — live stub", () => {
  it("returns failure (not yet implemented)", async () => {
    const program = pipe(
      Effect.flatMap(CommandService, (svc) => svc.exec("echo", ["hello"])),
      Effect.provide(CommandServiceLive),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as CommandError;
      expect(err._tag).toBe("CommandError");
      expect(err.message).toContain("not yet implemented");
    }
  });
});

// ── GitService ──

const gitMockLayer = CommandServiceTest({
  "git log --oneline -10": { stdout: "abc123 first\ndef456 second\n", exitCode: 0 },
  "git log --oneline -5": { stdout: "abc123 first\n", exitCode: 0 },
  "git diff": { stdout: "diff --git a/file.ts\n+added line\n", exitCode: 0 },
  "git diff HEAD~1": { stdout: "diff --git a/other.ts\n-removed line\n", exitCode: 0 },
  "git branch --show-current": { stdout: "feat/my-branch\n", exitCode: 0 },
  "git status --porcelain": { stdout: "M  src/file.ts\n?? new-file.ts\n", exitCode: 0 },
});

const gitTestLayer = Layer.provide(GitServiceLive, gitMockLayer);

describe("GitService — log()", () => {
  it("calls CommandService with default n=10", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.log()),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("abc123 first\ndef456 second\n");
  });

  it("calls CommandService with custom n", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.log(5)),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("abc123 first\n");
  });
});

describe("GitService — diff()", () => {
  it("calls diff without ref", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.diff()),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toContain("+added line");
  });

  it("calls diff with ref", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.diff("HEAD~1")),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toContain("-removed line");
  });
});

describe("GitService — branch()", () => {
  it("returns trimmed branch name", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.branch()),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("feat/my-branch");
  });
});

describe("GitService — status()", () => {
  it("returns porcelain output", async () => {
    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.status()),
      Effect.provide(gitTestLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toContain("M  src/file.ts");
    expect(result).toContain("?? new-file.ts");
  });
});

describe("GitService — error mapping (CommandError → GitError)", () => {
  it("maps CommandError to GitError with operation context", async () => {
    const emptyMock = CommandServiceTest({});
    const failLayer = Layer.provide(GitServiceLive, emptyMock);

    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.log()),
      Effect.provide(failLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as GitError;
      expect(err._tag).toBe("GitError");
      expect(err.operation).toBe("log");
      expect(err.message).toContain("No mock response for");
    }
  });

  it("maps diff error with correct operation", async () => {
    const emptyMock = CommandServiceTest({});
    const failLayer = Layer.provide(GitServiceLive, emptyMock);

    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.diff()),
      Effect.provide(failLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as GitError;
      expect(err._tag).toBe("GitError");
      expect(err.operation).toBe("diff");
    }
  });

  it("maps branch error with correct operation", async () => {
    const emptyMock = CommandServiceTest({});
    const failLayer = Layer.provide(GitServiceLive, emptyMock);

    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.branch()),
      Effect.provide(failLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as GitError;
      expect(err.operation).toBe("branch");
    }
  });

  it("maps status error with correct operation", async () => {
    const emptyMock = CommandServiceTest({});
    const failLayer = Layer.provide(GitServiceLive, emptyMock);

    const program = pipe(
      Effect.flatMap(GitService, (svc) => svc.status()),
      Effect.provide(failLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as GitError;
      expect(err.operation).toBe("status");
    }
  });
});

// ── Layer composition ──

describe("Layer composition — GitServiceLive + CommandServiceTest", () => {
  it("composes correctly and runs a full git operation chain", async () => {
    const mockResponses = {
      "git branch --show-current": { stdout: "main\n", exitCode: 0 },
      "git status --porcelain": { stdout: "", exitCode: 0 },
      "git log --oneline -3": { stdout: "aaa first\nbbb second\nccc third\n", exitCode: 0 },
    };

    const composedLayer = Layer.provide(
      GitServiceLive,
      CommandServiceTest(mockResponses),
    );

    const program = pipe(
      Effect.flatMap(GitService, (svc) =>
        Effect.all({
          branch: svc.branch(),
          status: svc.status(),
          log: svc.log(3),
        }),
      ),
      Effect.provide(composedLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result.branch).toBe("main");
    expect(result.status).toBe("");
    expect(result.log).toContain("aaa first");
    expect(result.log).toContain("ccc third");
  });
});
