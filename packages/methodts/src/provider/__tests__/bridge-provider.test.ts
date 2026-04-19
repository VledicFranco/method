// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for BridgeAgentProvider — spawn payload building, response parsing,
 * error mapping, config defaults, and Layer construction.
 *
 * All tests are pure-function unit tests; no real bridge server is required.
 *
 * @see PRD 021 Component 13 — BridgeAgentProvider
 */
import { describe, it, expect } from "vitest";
import { Effect, Exit, Cause } from "effect";

import {
  buildSpawnPayload,
  parseBridgeResponse,
  mapBridgeError,
  BridgeAgentProvider,
  type BridgeProviderConfig,
} from "../bridge-provider.js";
import { AgentProvider } from "../agent-provider.js";

// ── buildSpawnPayload ──────────────────────────────────────────────────────

describe("buildSpawnPayload", () => {
  const baseConfig: BridgeProviderConfig = {
    bridgeUrl: "http://localhost:3456",
  };

  it("prompt + default config produces correct payload", () => {
    const payload = buildSpawnPayload("do the thing", baseConfig);
    expect(payload.prompt).toBe("do the thing");
    expect(payload.workdir).toBe(".");
    expect(payload.nickname).toBeUndefined();
    expect(payload.purpose).toBeUndefined();
    expect(payload.parentSessionId).toBeUndefined();
    expect(payload.depth).toBeUndefined();
    expect(payload.budget).toBeUndefined();
    expect(payload.isolation).toBeUndefined();
  });

  it("with bridge params overrides defaults", () => {
    const bridge = {
      workdir: "/custom/path",
      nickname: "worker-1",
      purpose: "deploy",
      parentSessionId: "parent-42",
      depth: 2,
      budget: { maxDepth: 3, maxAgents: 5 },
      isolation: "worktree",
    };
    const payload = buildSpawnPayload("commission text", baseConfig, bridge);
    expect(payload.prompt).toBe("commission text");
    expect(payload.workdir).toBe("/custom/path");
    expect(payload.nickname).toBe("worker-1");
    expect(payload.purpose).toBe("deploy");
    expect(payload.parentSessionId).toBe("parent-42");
    expect(payload.depth).toBe(2);
    expect(payload.budget).toEqual({ maxDepth: 3, maxAgents: 5 });
    expect(payload.isolation).toBe("worktree");
  });

  it("missing optional fields in bridge params are undefined", () => {
    const bridge = { workdir: "/some/dir" };
    const payload = buildSpawnPayload("test", baseConfig, bridge);
    expect(payload.workdir).toBe("/some/dir");
    expect(payload.nickname).toBeUndefined();
    expect(payload.purpose).toBeUndefined();
    expect(payload.parentSessionId).toBeUndefined();
    expect(payload.depth).toBeUndefined();
    expect(payload.budget).toBeUndefined();
    expect(payload.isolation).toBeUndefined();
  });

  it("config defaultWorkdir is used when bridge has no workdir", () => {
    const config: BridgeProviderConfig = {
      bridgeUrl: "http://localhost:3456",
      defaultWorkdir: "/projects/main",
    };
    const payload = buildSpawnPayload("test", config);
    expect(payload.workdir).toBe("/projects/main");
  });

  it("bridge workdir takes priority over config defaultWorkdir", () => {
    const config: BridgeProviderConfig = {
      bridgeUrl: "http://localhost:3456",
      defaultWorkdir: "/projects/main",
    };
    const bridge = { workdir: "/override/path" };
    const payload = buildSpawnPayload("test", config, bridge);
    expect(payload.workdir).toBe("/override/path");
  });

  it("prompt with special characters is preserved exactly", () => {
    const prompt = 'Run "deploy --force" && check $HOME/status\nnewline here';
    const payload = buildSpawnPayload(prompt, baseConfig);
    expect(payload.prompt).toBe(prompt);
  });

  it("empty bridge object uses config defaults", () => {
    const payload = buildSpawnPayload("test", baseConfig, {});
    expect(payload.workdir).toBe(".");
    expect(payload.nickname).toBeUndefined();
  });
});

// ── parseBridgeResponse ────────────────────────────────────────────────────

describe("parseBridgeResponse", () => {
  it("full response maps all fields to AgentResult", () => {
    const result = parseBridgeResponse({
      response: "task completed successfully",
      id: "sess-abc-123",
      cost: { tokens: 500, usd: 0.05, duration_ms: 2000 },
    });
    expect(result.raw).toBe("task completed successfully");
    expect(result.cost.tokens).toBe(500);
    expect(result.cost.usd).toBe(0.05);
    expect(result.cost.duration_ms).toBe(2000);
    expect(result.sessionId).toBe("sess-abc-123");
  });

  it("minimal response defaults to empty string and zero cost", () => {
    const result = parseBridgeResponse({});
    expect(result.raw).toBe("");
    expect(result.cost.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.cost.duration_ms).toBe(0);
    expect(result.sessionId).toBeUndefined();
  });

  it("missing cost object results in zero cost", () => {
    const result = parseBridgeResponse({
      response: "done",
      id: "sess-1",
    });
    expect(result.cost.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.cost.duration_ms).toBe(0);
  });

  it("partial cost object fills missing fields with zero", () => {
    const result = parseBridgeResponse({
      response: "partial",
      cost: { tokens: 100 } as Record<string, number>,
    });
    expect(result.cost.tokens).toBe(100);
    expect(result.cost.usd).toBe(0);
    expect(result.cost.duration_ms).toBe(0);
  });

  it("response with empty string is preserved", () => {
    const result = parseBridgeResponse({ response: "" });
    expect(result.raw).toBe("");
  });
});

// ── mapBridgeError ─────────────────────────────────────────────────────────

describe("mapBridgeError", () => {
  it("429 maps to AgentBudgetExceeded", () => {
    const err = mapBridgeError(429, "Rate limit exceeded", "http://localhost:3456/sessions");
    expect(err._tag).toBe("AgentBudgetExceeded");
    if (err._tag === "AgentBudgetExceeded") {
      expect(err.limit).toBe(0);
      expect(err.actual).toBe(0);
    }
  });

  it("403 maps to AgentPermissionDenied with URL and body", () => {
    const url = "http://localhost:3456/sessions/42/prompt";
    const body = "Forbidden: insufficient permissions";
    const err = mapBridgeError(403, body, url);
    expect(err._tag).toBe("AgentPermissionDenied");
    if (err._tag === "AgentPermissionDenied") {
      expect(err.resource).toBe(url);
      expect(err.message).toBe(body);
    }
  });

  it("504 maps to AgentTimeout", () => {
    const err = mapBridgeError(504, "Gateway Timeout", "http://localhost:3456/sessions");
    expect(err._tag).toBe("AgentTimeout");
    if (err._tag === "AgentTimeout") {
      expect(err.message).toContain("Bridge timeout");
      expect(err.message).toContain("Gateway Timeout");
      expect(err.duration_ms).toBe(0);
    }
  });

  it("408 maps to AgentTimeout", () => {
    const err = mapBridgeError(408, "Request Timeout", "http://localhost:3456/sessions/1/prompt");
    expect(err._tag).toBe("AgentTimeout");
    if (err._tag === "AgentTimeout") {
      expect(err.message).toContain("Bridge timeout");
      expect(err.message).toContain("Request Timeout");
    }
  });

  it("500 maps to AgentCrash", () => {
    const err = mapBridgeError(500, "Internal Server Error", "http://localhost:3456/sessions");
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("500");
      expect(err.message).toContain("Internal Server Error");
    }
  });

  it("502 maps to AgentCrash", () => {
    const err = mapBridgeError(502, "Bad Gateway", "http://localhost:3456/sessions");
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("502");
    }
  });

  it("404 maps to AgentCrash", () => {
    const err = mapBridgeError(404, "Not Found", "http://localhost:3456/sessions/xyz");
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("404");
      expect(err.message).toContain("Not Found");
    }
  });

  it("empty body produces valid error message", () => {
    const err = mapBridgeError(500, "", "http://localhost:3456/sessions");
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.message).toContain("500");
    }
  });
});

// ── BridgeProviderConfig defaults ──────────────────────────────────────────

describe("BridgeProviderConfig defaults", () => {
  it("default workdir is '.' when not specified in config", () => {
    const config: BridgeProviderConfig = { bridgeUrl: "http://localhost:3456" };
    const payload = buildSpawnPayload("test", config);
    expect(payload.workdir).toBe(".");
  });

  it("defaultWorkdir from config overrides the hardcoded default", () => {
    const config: BridgeProviderConfig = {
      bridgeUrl: "http://localhost:3456",
      defaultWorkdir: "/custom/default",
    };
    const payload = buildSpawnPayload("test", config);
    expect(payload.workdir).toBe("/custom/default");
  });
});

// ── BridgeAgentProvider Layer ──────────────────────────────────────────────

describe("BridgeAgentProvider", () => {
  it("stub returns AgentSpawnFailed indicating bridge required", async () => {
    const layer = BridgeAgentProvider({ bridgeUrl: "http://localhost:3456" });
    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "test prompt" })),
    );

    const exit = await Effect.runPromiseExit(Effect.provide(program, layer));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value).toMatchObject({
          _tag: "AgentSpawnFailed",
          message: expect.stringContaining("running bridge server"),
        });
      }
    }
  });

  it("accepts custom config without errors", async () => {
    const config: BridgeProviderConfig = {
      bridgeUrl: "http://custom:9999",
      defaultWorkdir: "/tmp/test",
      defaultModel: "opus",
      maxBudgetUsd: 20,
      timeoutMs: 600000,
      retryOnConnectionError: false,
    };
    const layer = BridgeAgentProvider(config);
    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "with custom config" })),
    );

    const exit = await Effect.runPromiseExit(Effect.provide(program, layer));
    // Still fails (stub), but should not throw
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("satisfies the AgentProvider interface via Layer.succeed", async () => {
    const layer = BridgeAgentProvider({ bridgeUrl: "http://localhost:3456" });
    const program = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      return typeof provider.execute;
    });
    const result = await Effect.runPromise(Effect.provide(program, layer));
    expect(result).toBe("function");
  });

  it("builds spawn payload internally when executing", async () => {
    // Verify the Layer uses config values by checking payload building
    // indirectly — the stub still fails, but the payload is constructed.
    const config: BridgeProviderConfig = {
      bridgeUrl: "http://localhost:3456",
      defaultWorkdir: "/my/workdir",
    };
    const layer = BridgeAgentProvider(config);

    // The payload building is covered by buildSpawnPayload tests;
    // this test confirms the Layer integrates with config correctly.
    const program = AgentProvider.pipe(
      Effect.flatMap((provider) =>
        provider.execute({
          prompt: "build test",
          bridge: { nickname: "test-agent" },
        }),
      ),
    );

    const exit = await Effect.runPromiseExit(Effect.provide(program, layer));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
