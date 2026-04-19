// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for testRunner and httpChecker gate runners.
 *
 * @see PRD 021 Component 7 — gate runners
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { testRunner } from "../runners/test-runner.js";
import { httpChecker } from "../runners/http-checker.js";
import type { FetchFn } from "../runners/http-checker.js";
import type { CommandService } from "../../extractor/services/command.js";

// ── Test state ──

type TestState = { value: number };
const state: TestState = { value: 42 };

// ── Helper: mock CommandService ──

function mockCommandService(
  responses: Record<string, { stdout: string; exitCode: number }>,
): CommandService {
  return {
    exec: (command, args) => {
      const key = args ? `${command} ${args.join(" ")}` : command;
      const resp = responses[key] ?? responses[command];
      if (resp) return Effect.succeed(resp);
      return Effect.fail({
        _tag: "CommandError" as const,
        command,
        message: `No mock response for: ${key}`,
        exitCode: 127,
      });
    },
  };
}

// ── Helper: mock fetch ──

function mockFetch(status: number, body: string): FetchFn {
  return (_url: string) =>
    Promise.resolve({
      status,
      text: () => Promise.resolve(body),
    });
}

function failingFetch(errorMessage: string): FetchFn {
  return (_url: string) => Promise.reject(new Error(errorMessage));
}

// ── testRunner ──

describe("testRunner", () => {
  it("exit code 0 → pass", () => {
    const cmd = mockCommandService({
      "npm test": { stdout: "All tests passed", exitCode: 0 },
    });
    const gate = testRunner<TestState>("t1", "npm test", cmd);
    const result = Effect.runSync(gate.evaluate(state));

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("Command passed: npm test");
    expect(result.feedback).toBeUndefined();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.witness).toBeNull();
  });

  it("exit code 1 → fail with stdout as feedback", () => {
    const cmd = mockCommandService({
      "npm test": { stdout: "3 tests failed\nAssertionError: expected 1 to be 2", exitCode: 1 },
    });
    const gate = testRunner<TestState>("t2", "npm test", cmd);
    const result = Effect.runSync(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Command failed with exit code 1");
    expect(result.feedback).toBe("3 tests failed\nAssertionError: expected 1 to be 2");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("command not found → fail via catchAll (CommandError)", () => {
    const cmd = mockCommandService({}); // no responses configured
    const gate = testRunner<TestState>("t3", "nonexistent-cmd", cmd);
    const result = Effect.runSync(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Command failed with exit code");
    expect(result.feedback).toBeDefined();
  });

  it("passes command arguments correctly", () => {
    const cmd = mockCommandService({
      "npm run test -- --coverage": { stdout: "Coverage: 95%", exitCode: 0 },
    });
    const gate = testRunner<TestState>("t4", "npm", cmd, ["run", "test", "--", "--coverage"]);
    const result = Effect.runSync(gate.evaluate(state));

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("Command passed: npm");
  });

  it("gate metadata is correct", () => {
    const cmd = mockCommandService({});
    const gate = testRunner<TestState>("my-test", "npm test", cmd);

    expect(gate.id).toBe("my-test");
    expect(gate.description).toBe("Test runner: npm test");
    expect(gate.maxRetries).toBe(0);
  });
});

// ── httpChecker ──

describe("httpChecker", () => {
  it("200 + matching body → pass", async () => {
    const fetch = mockFetch(200, '{"status":"ok","version":"1.2.3"}');
    const gate = httpChecker<TestState>("h1", "http://localhost:3456/health", { status: 200, bodyContains: '"status":"ok"' }, fetch);
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(true);
    expect(result.reason).toBe("HTTP check passed: http://localhost:3456/health");
    expect(result.feedback).toBeUndefined();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("500 → fail", async () => {
    const fetch = mockFetch(500, "Internal Server Error");
    const gate = httpChecker<TestState>("h2", "http://localhost:3456/health", { status: 200 }, fetch);
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Expected status 200, got 500");
  });

  it("200 + non-matching body → fail", async () => {
    const fetch = mockFetch(200, '{"status":"error"}');
    const gate = httpChecker<TestState>("h3", "http://localhost:3456/health", { status: 200, bodyContains: '"status":"ok"' }, fetch);
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Body does not contain');
  });

  it("default expected status is 200", async () => {
    const fetch = mockFetch(200, "OK");
    const gate = httpChecker<TestState>("h4", "http://example.com", {}, fetch);
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(true);
  });

  it("fetch failure → GateError", async () => {
    const fetch = failingFetch("ECONNREFUSED");
    const gate = httpChecker<TestState>("h5", "http://localhost:9999", { status: 200 }, fetch);

    const exit = await Effect.runPromiseExit(gate.evaluate(state));
    // The Effect should fail with a GateError
    expect(exit._tag).toBe("Failure");
  });

  it("gate metadata is correct", () => {
    const fetch = mockFetch(200, "");
    const gate = httpChecker<TestState>("my-http", "http://example.com/api", { status: 200 }, fetch);

    expect(gate.id).toBe("my-http");
    expect(gate.description).toBe("HTTP check: http://example.com/api");
    expect(gate.maxRetries).toBe(0);
  });

  it("status mismatch without body check includes correct reason", async () => {
    const fetch = mockFetch(404, "Not Found");
    const gate = httpChecker<TestState>("h6", "http://example.com", { status: 200 }, fetch);
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Expected status 200, got 404");
  });
});
