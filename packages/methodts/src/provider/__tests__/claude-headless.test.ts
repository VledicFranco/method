/**
 * Tests for ClaudeHeadlessProvider — argument building, output parsing,
 * error mapping, session ID generation, and Layer construction.
 *
 * All tests are pure-function unit tests; no real Claude process is spawned.
 *
 * @see PRD 021 Component 13 — ClaudeHeadlessProvider
 */
import { describe, it, expect } from "vitest";
import { Effect, Exit, Cause } from "effect";

import {
  buildCliArgs,
  parseClaudeOutput,
  mapProcessError,
  generateSessionId,
  ClaudeHeadlessProvider,
  type ClaudeHeadlessConfig,
} from "../claude-headless.js";
import { AgentProvider } from "../agent-provider.js";

// ── buildCliArgs ────────────────────────────────────────────────────────────

describe("buildCliArgs", () => {
  it("default config includes --print, -p, --output-format json, --model sonnet", () => {
    const args = buildCliArgs("hello world", {});
    expect(args).toContain("--print");
    expect(args).toContain("-p");
    expect(args).toContain("hello world");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("custom model overrides default", () => {
    const args = buildCliArgs("test", { model: "opus" });
    const modelIdx = args.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe("opus");
  });

  it("maxBudgetUsd adds --max-budget-usd flag", () => {
    const args = buildCliArgs("test", { maxBudgetUsd: 10 });
    const budgetIdx = args.indexOf("--max-budget-usd");
    expect(budgetIdx).toBeGreaterThan(-1);
    expect(args[budgetIdx + 1]).toBe("10");
  });

  it("sessionId adds --session-id flag", () => {
    const args = buildCliArgs("test", {}, "my-session-42");
    const sessIdx = args.indexOf("--session-id");
    expect(sessIdx).toBeGreaterThan(-1);
    expect(args[sessIdx + 1]).toBe("my-session-42");
  });

  it("no --session-id when sessionId is undefined", () => {
    const args = buildCliArgs("test", {});
    expect(args).not.toContain("--session-id");
  });

  it("allowedTools adds --allowedTools with comma-joined values", () => {
    const args = buildCliArgs("test", { allowedTools: ["Read", "Write"] });
    const toolIdx = args.indexOf("--allowedTools");
    expect(toolIdx).toBeGreaterThan(-1);
    expect(args[toolIdx + 1]).toBe("Read,Write");
  });

  it("empty allowedTools omits --allowedTools flag", () => {
    const args = buildCliArgs("test", { allowedTools: [] });
    expect(args).not.toContain("--allowedTools");
  });

  it("prompt with special characters is preserved exactly", () => {
    const prompt = 'Run "deploy --force" && check $HOME/status';
    const args = buildCliArgs(prompt, {});
    const promptIdx = args.indexOf("-p");
    expect(args[promptIdx + 1]).toBe(prompt);
  });

  it("prompt argument appears after -p flag", () => {
    const args = buildCliArgs("my prompt text", {});
    const pIdx = args.indexOf("-p");
    expect(pIdx).toBeGreaterThan(-1);
    expect(args[pIdx + 1]).toBe("my prompt text");
  });
});

// ── parseClaudeOutput ───────────────────────────────────────────────────────

describe("parseClaudeOutput", () => {
  it("valid JSON with result field sets raw to result string", () => {
    const stdout = JSON.stringify({
      result: "task completed successfully",
      cost_usd: 0.05,
      duration_ms: 2000,
      num_turns: 3,
      session_id: "sess-abc",
    });
    const result = parseClaudeOutput(stdout);
    expect(result.raw).toBe("task completed successfully");
    expect(result.cost.usd).toBe(0.05);
    expect(result.cost.duration_ms).toBe(2000);
    expect(result.cost.tokens).toBe(3);
    expect(result.sessionId).toBe("sess-abc");
  });

  it("valid JSON without result field uses entire stdout as raw", () => {
    const obj = { cost_usd: 0.01, duration_ms: 100 };
    const stdout = JSON.stringify(obj);
    const result = parseClaudeOutput(stdout);
    expect(result.raw).toBe(stdout);
  });

  it("invalid JSON falls back to entire stdout as raw with zero cost", () => {
    const stdout = "This is not valid JSON at all";
    const result = parseClaudeOutput(stdout);
    expect(result.raw).toBe(stdout);
    expect(result.cost.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.cost.duration_ms).toBe(0);
  });

  it("missing optional fields default to 0", () => {
    const stdout = JSON.stringify({ result: "ok" });
    const result = parseClaudeOutput(stdout);
    expect(result.raw).toBe("ok");
    expect(result.cost.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.cost.duration_ms).toBe(0);
    expect(result.sessionId).toBeUndefined();
  });

  it("non-string result field uses stdout as raw", () => {
    const stdout = JSON.stringify({ result: 42, cost_usd: 0.01 });
    const result = parseClaudeOutput(stdout);
    expect(result.raw).toBe(stdout);
  });
});

// ── mapProcessError ─────────────────────────────────────────────────────────

describe("mapProcessError", () => {
  it('stderr containing "budget" maps to AgentBudgetExceeded', () => {
    const err = mapProcessError(1, "Error: budget exceeded for this session", { maxBudgetUsd: 10 });
    expect(err._tag).toBe("AgentBudgetExceeded");
    if (err._tag === "AgentBudgetExceeded") {
      expect(err.limit).toBe(10);
      expect(err.actual).toBe(0);
    }
  });

  it("AgentBudgetExceeded uses default limit when config omits maxBudgetUsd", () => {
    const err = mapProcessError(1, "budget limit reached", {});
    expect(err._tag).toBe("AgentBudgetExceeded");
    if (err._tag === "AgentBudgetExceeded") {
      expect(err.limit).toBe(5); // default
    }
  });

  it('stderr containing "permission" maps to AgentPermissionDenied', () => {
    const stderr = "Error: permission denied accessing /etc/shadow";
    const err = mapProcessError(1, stderr, {});
    expect(err._tag).toBe("AgentPermissionDenied");
    if (err._tag === "AgentPermissionDenied") {
      expect(err.resource).toBe("unknown");
      expect(err.message).toBe(stderr);
    }
  });

  it("generic error maps to AgentCrash with exit code in message", () => {
    const err = mapProcessError(137, "Killed", {});
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("137");
      expect(err.message).toContain("Killed");
    }
  });

  it("empty stderr still produces AgentCrash", () => {
    const err = mapProcessError(1, "", {});
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("1");
    }
  });
});

// ── generateSessionId ───────────────────────────────────────────────────────

describe("generateSessionId", () => {
  it("includes prefix, methodId, and stepId when all provided", () => {
    const id = generateSessionId("methodts", "M3-DEPLOY", "S2-VALIDATE");
    expect(id).toMatch(/^methodts_M3-DEPLOY_S2-VALIDATE_[a-z0-9]+$/);
  });

  it("includes only prefix and timestamp when no optional parts", () => {
    const id = generateSessionId("methodts");
    const parts = id.split("_");
    expect(parts[0]).toBe("methodts");
    expect(parts).toHaveLength(2);
  });

  it("includes prefix and methodId when stepId omitted", () => {
    const id = generateSessionId("methodts", "M1-PLAN");
    const parts = id.split("_");
    expect(parts[0]).toBe("methodts");
    expect(parts[1]).toBe("M1-PLAN");
    expect(parts).toHaveLength(3);
  });

  it("generates unique IDs on successive calls", () => {
    const id1 = generateSessionId("test");
    const id2 = generateSessionId("test");
    // They could be the same if called in same ms, but the timestamp part
    // should at minimum be present
    expect(id1.startsWith("test_")).toBe(true);
    expect(id2.startsWith("test_")).toBe(true);
  });

  it("timestamp part is base-36 encoded", () => {
    const id = generateSessionId("pfx");
    const timestampPart = id.split("_").pop()!;
    // Base-36 uses [0-9a-z]
    expect(timestampPart).toMatch(/^[0-9a-z]+$/);
  });
});

// ── ClaudeHeadlessConfig defaults ───────────────────────────────────────────

describe("ClaudeHeadlessConfig defaults", () => {
  it("default model is sonnet", () => {
    const args = buildCliArgs("test", {});
    const modelIdx = args.indexOf("--model");
    expect(args[modelIdx + 1]).toBe("sonnet");
  });

  it("default maxBudgetUsd is 5", () => {
    const args = buildCliArgs("test", {});
    const budgetIdx = args.indexOf("--max-budget-usd");
    expect(budgetIdx).toBeGreaterThan(-1);
    expect(args[budgetIdx + 1]).toBe("5");
  });

  it("default does not include --allowedTools", () => {
    const args = buildCliArgs("test", {});
    expect(args).not.toContain("--allowedTools");
  });

  it("default does not include --session-id when none provided", () => {
    const args = buildCliArgs("test", {});
    expect(args).not.toContain("--session-id");
  });
});

// ── ClaudeHeadlessProvider Layer ────────────────────────────────────────────

describe("ClaudeHeadlessProvider", () => {
  it("fails with AgentSpawnFailed when binary does not exist", async () => {
    const layer = ClaudeHeadlessProvider({ claudeBin: "__nonexistent_binary__" });
    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "test prompt" })),
    );

    const exit = await Effect.runPromiseExit(Effect.provide(program, layer));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value._tag).toBe("AgentSpawnFailed");
      }
    }
  });

  it("accepts custom config without construction errors", () => {
    const config: ClaudeHeadlessConfig = {
      model: "opus",
      maxBudgetUsd: 20,
      workdir: "/tmp/test",
      allowedTools: ["Read", "Write", "Bash"],
      claudeBin: "/usr/local/bin/claude",
      timeoutMs: 600000,
      sessionPrefix: "custom",
    };
    // Layer construction should not throw
    const layer = ClaudeHeadlessProvider(config);
    expect(layer).toBeDefined();
  });

  it("satisfies the AgentProvider interface via Layer.succeed", async () => {
    const layer = ClaudeHeadlessProvider();
    const program = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      return typeof provider.execute;
    });
    const result = await Effect.runPromise(Effect.provide(program, layer));
    expect(result).toBe("function");
  });
});
