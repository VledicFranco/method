// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for enriched AgentProvider — rich cost tracking, resume support,
 * streaming interface, and new type constructions.
 *
 * Covers: TokenUsage, ModelUsage, AgentStreamEvent, enriched parseClaudeOutput,
 * buildCliArgs resume support, and MockAgentProvider with new commission fields.
 *
 * @see Commission: Enrich AgentProvider with rich cost, resume, streaming
 */
import { describe, it, expect } from "vitest";
import { Effect } from "effect";

import type { AgentResult, TokenUsage, ModelUsage, AgentStreamEvent } from "../agent-provider.js";
import { AgentProvider } from "../agent-provider.js";
import { buildCliArgs, parseClaudeOutput } from "../claude-headless.js";
import { MockAgentProvider } from "../mock-provider.js";

// ── TokenUsage type construction ──────────────────────────────────────────

describe("TokenUsage type construction", () => {
  it("constructs with all required fields", () => {
    const usage: TokenUsage = {
      inputTokens: 1500,
      outputTokens: 800,
      cacheCreationTokens: 200,
      cacheReadTokens: 300,
    };

    expect(usage.inputTokens).toBe(1500);
    expect(usage.outputTokens).toBe(800);
    expect(usage.cacheCreationTokens).toBe(200);
    expect(usage.cacheReadTokens).toBe(300);
  });

  it("allows zero values for all fields", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});

// ── ModelUsage type construction ──────────────────────────────────────────

describe("ModelUsage type construction", () => {
  it("constructs with all required fields", () => {
    const modelUsage: ModelUsage = {
      inputTokens: 2000,
      outputTokens: 500,
      costUsd: 0.035,
    };

    expect(modelUsage.inputTokens).toBe(2000);
    expect(modelUsage.outputTokens).toBe(500);
    expect(modelUsage.costUsd).toBe(0.035);
  });
});

// ── AgentStreamEvent type construction ────────────────────────────────────

describe("AgentStreamEvent type construction", () => {
  it("constructs with all fields", () => {
    const event: AgentStreamEvent = {
      type: "tool_use",
      subtype: "bash",
      data: { command: "npm test" },
      timestamp: new Date("2026-03-22T12:00:00Z"),
    };

    expect(event.type).toBe("tool_use");
    expect(event.subtype).toBe("bash");
    expect(event.data).toEqual({ command: "npm test" });
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it("constructs with only required fields", () => {
    const event: AgentStreamEvent = {
      type: "text",
      timestamp: new Date(),
    };

    expect(event.type).toBe("text");
    expect(event.subtype).toBeUndefined();
    expect(event.data).toBeUndefined();
  });
});

// ── AgentResult with rich fields ──────────────────────────────────────────

describe("AgentResult with rich fields", () => {
  it("constructs with all rich fields", () => {
    const result: AgentResult = {
      raw: "task completed",
      cost: { tokens: 3500, usd: 0.05, duration_ms: 5000 },
      sessionId: "sess-abc",
      usage: {
        inputTokens: 2000,
        outputTokens: 1500,
        cacheCreationTokens: 100,
        cacheReadTokens: 400,
      },
      modelUsage: {
        "claude-sonnet-4-20250514": {
          inputTokens: 2000,
          outputTokens: 1500,
          costUsd: 0.05,
        },
      },
      numTurns: 5,
      stopReason: "end_turn",
      permissionDenials: ["Bash(rm -rf /)"],
    };

    expect(result.usage?.inputTokens).toBe(2000);
    expect(result.modelUsage?.["claude-sonnet-4-20250514"]?.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(5);
    expect(result.stopReason).toBe("end_turn");
    expect(result.permissionDenials).toEqual(["Bash(rm -rf /)"]);
  });

  it("rich fields are all optional — backward compatible", () => {
    const result: AgentResult = {
      raw: "minimal",
      cost: { tokens: 10, usd: 0.001, duration_ms: 50 },
    };

    expect(result.usage).toBeUndefined();
    expect(result.modelUsage).toBeUndefined();
    expect(result.numTurns).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
    expect(result.permissionDenials).toBeUndefined();
  });
});

// ── parseClaudeOutput — rich fields ───────────────────────────────────────

describe("parseClaudeOutput — rich fields", () => {
  it("full JSON with usage/model_usage/stop_reason populates all rich fields", () => {
    const stdout = JSON.stringify({
      result: "analysis complete",
      total_cost_usd: 0.12,
      duration_ms: 8000,
      session_id: "sess-rich",
      usage: {
        input_tokens: 5000,
        output_tokens: 2000,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 1500,
      },
      model_usage: {
        "claude-sonnet-4-20250514": {
          input_tokens: 3000,
          output_tokens: 1200,
          cost_usd: 0.06,
        },
        "claude-haiku-3.5": {
          input_tokens: 2000,
          output_tokens: 800,
          cost_usd: 0.02,
        },
      },
      num_turns: 7,
      stop_reason: "end_turn",
      permission_denials: ["Bash(sudo rm -rf /)", "Write(/etc/passwd)"],
    });

    const result = parseClaudeOutput(stdout);

    // Core fields
    expect(result.raw).toBe("analysis complete");
    expect(result.cost.tokens).toBe(7000); // 5000 + 2000
    expect(result.cost.usd).toBe(0.12);
    expect(result.cost.duration_ms).toBe(8000);
    expect(result.sessionId).toBe("sess-rich");

    // Rich usage
    expect(result.usage).toEqual({
      inputTokens: 5000,
      outputTokens: 2000,
      cacheCreationTokens: 300,
      cacheReadTokens: 1500,
    });

    // Per-model usage
    expect(result.modelUsage).toBeDefined();
    expect(result.modelUsage!["claude-sonnet-4-20250514"]).toEqual({
      inputTokens: 3000,
      outputTokens: 1200,
      costUsd: 0.06,
    });
    expect(result.modelUsage!["claude-haiku-3.5"]).toEqual({
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: 0.02,
    });

    // Turns, stop reason, denials
    expect(result.numTurns).toBe(7);
    expect(result.stopReason).toBe("end_turn");
    expect(result.permissionDenials).toEqual([
      "Bash(sudo rm -rf /)",
      "Write(/etc/passwd)",
    ]);
  });

  it("JSON without rich fields returns undefined for optional fields", () => {
    const stdout = JSON.stringify({
      result: "simple output",
      cost_usd: 0.01,
      duration_ms: 500,
    });

    const result = parseClaudeOutput(stdout);

    expect(result.raw).toBe("simple output");
    expect(result.usage).toBeUndefined();
    expect(result.modelUsage).toBeUndefined();
    expect(result.numTurns).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
    expect(result.permissionDenials).toBeUndefined();
  });

  it("prefers total_cost_usd over cost_usd for cost.usd", () => {
    const stdout = JSON.stringify({
      result: "ok",
      cost_usd: 0.05,
      total_cost_usd: 0.12,
    });

    const result = parseClaudeOutput(stdout);
    expect(result.cost.usd).toBe(0.12);
  });

  it("falls back to cost_usd when total_cost_usd is absent", () => {
    const stdout = JSON.stringify({
      result: "ok",
      cost_usd: 0.05,
    });

    const result = parseClaudeOutput(stdout);
    expect(result.cost.usd).toBe(0.05);
  });

  it("empty permission_denials array results in undefined", () => {
    const stdout = JSON.stringify({
      result: "ok",
      permission_denials: [],
    });

    const result = parseClaudeOutput(stdout);
    expect(result.permissionDenials).toBeUndefined();
  });

  it("tokens computed from usage input+output, not num_turns", () => {
    const stdout = JSON.stringify({
      result: "ok",
      num_turns: 5,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
      },
    });

    const result = parseClaudeOutput(stdout);
    expect(result.cost.tokens).toBe(1500); // 1000 + 500, not 5
    expect(result.numTurns).toBe(5);
  });

  it("handles model_usage with camelCase field names", () => {
    const stdout = JSON.stringify({
      result: "ok",
      model_usage: {
        "claude-opus-4-20250514": {
          inputTokens: 4000,
          outputTokens: 1000,
          costUSD: 0.15,
        },
      },
    });

    const result = parseClaudeOutput(stdout);
    expect(result.modelUsage!["claude-opus-4-20250514"]).toEqual({
      inputTokens: 4000,
      outputTokens: 1000,
      costUsd: 0.15,
    });
  });
});

// ── buildCliArgs — resume support ─────────────────────────────────────────

describe("buildCliArgs — resume support", () => {
  it("with resumeSessionId includes --resume flag", () => {
    const args = buildCliArgs("test", {}, undefined, "sess-to-resume");
    expect(args).toContain("--resume");
    const idx = args.indexOf("--resume");
    expect(args[idx + 1]).toBe("sess-to-resume");
  });

  it("with resumeSessionId does not include --session-id", () => {
    const args = buildCliArgs("test", {}, undefined, "sess-to-resume");
    expect(args).not.toContain("--session-id");
  });

  it("with sessionId but no resume includes --session-id", () => {
    const args = buildCliArgs("test", {}, "my-session");
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
    const idx = args.indexOf("--session-id");
    expect(args[idx + 1]).toBe("my-session");
  });

  it("with both resume and session — resume takes precedence", () => {
    const args = buildCliArgs("test", {}, "new-session", "old-session");
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    const idx = args.indexOf("--resume");
    expect(args[idx + 1]).toBe("old-session");
  });

  it("with neither resume nor session — no session flags", () => {
    const args = buildCliArgs("test", {});
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--session-id");
  });
});

// ── MockAgentProvider with new commission fields ──────────────────────────

describe("MockAgentProvider with new commission fields", () => {
  it("works when commission includes resumeSessionId", async () => {
    const config = {
      responses: [
        {
          match: (c: { prompt: string }) => c.prompt.includes("resume"),
          result: {
            raw: "resumed ok",
            cost: { tokens: 100, usd: 0.01, duration_ms: 200 },
            sessionId: "resumed-sess",
          } as AgentResult,
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) =>
        provider.execute({
          prompt: "resume previous work",
          resumeSessionId: "old-session-123",
        }),
      ),
    );
    const result = await Effect.runPromise(
      Effect.provide(program, MockAgentProvider(config)),
    );

    expect(result.raw).toBe("resumed ok");
  });

  it("works when commission includes explicit sessionId", async () => {
    const config = {
      responses: [
        {
          match: () => true,
          result: {
            raw: "with session",
            cost: { tokens: 50, usd: 0.005, duration_ms: 100 },
          } as AgentResult,
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) =>
        provider.execute({
          prompt: "do work",
          sessionId: "explicit-sess-456",
        }),
      ),
    );
    const result = await Effect.runPromise(
      Effect.provide(program, MockAgentProvider(config)),
    );

    expect(result.raw).toBe("with session");
  });

  it("works when commission includes both sessionId and resumeSessionId", async () => {
    const config = {
      responses: [
        {
          match: () => true,
          result: {
            raw: "both fields ok",
            cost: { tokens: 10, usd: 0.001, duration_ms: 50 },
          } as AgentResult,
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) =>
        provider.execute({
          prompt: "test",
          sessionId: "new-sess",
          resumeSessionId: "old-sess",
        }),
      ),
    );
    const result = await Effect.runPromise(
      Effect.provide(program, MockAgentProvider(config)),
    );

    expect(result.raw).toBe("both fields ok");
  });
});
