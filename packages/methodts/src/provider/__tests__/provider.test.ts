// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for AgentProvider interface, AgentResult/AgentError types,
 * and MockAgentProvider test double.
 *
 * @see PRD 021 Component 13 — AgentProvider + MockAgentProvider
 */
import { describe, it, expect } from "vitest";
import { Effect, Exit, Cause } from "effect";

import type { AgentResult, AgentError } from "../agent-provider.js";
import { AgentProvider } from "../agent-provider.js";
import { MockAgentProvider } from "../mock-provider.js";
import type { MockAgentProviderConfig } from "../mock-provider.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Standard successful result for reuse across tests. */
const okResult: AgentResult = {
  raw: "task completed",
  cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
  sessionId: "sess-001",
};

/** Result without optional sessionId. */
const minimalResult: AgentResult = {
  raw: "done",
  cost: { tokens: 10, usd: 0.001, duration_ms: 50 },
};

// ── AgentResult construction ────────────────────────────────────────────────

describe("AgentResult construction", () => {
  it("constructs with all fields including sessionId", () => {
    const result: AgentResult = {
      raw: "output text",
      cost: { tokens: 500, usd: 0.05, duration_ms: 2000 },
      sessionId: "bridge-42",
    };

    expect(result.raw).toBe("output text");
    expect(result.cost.tokens).toBe(500);
    expect(result.cost.usd).toBe(0.05);
    expect(result.cost.duration_ms).toBe(2000);
    expect(result.sessionId).toBe("bridge-42");
  });

  it("constructs without optional sessionId", () => {
    const result: AgentResult = {
      raw: "minimal output",
      cost: { tokens: 1, usd: 0.0001, duration_ms: 10 },
    };

    expect(result.raw).toBe("minimal output");
    expect(result.sessionId).toBeUndefined();
  });
});

// ── AgentError variants ─────────────────────────────────────────────────────

describe("AgentError variants", () => {
  it("constructs AgentTimeout with message and duration_ms", () => {
    const err: AgentError = {
      _tag: "AgentTimeout",
      message: "exceeded 30s limit",
      duration_ms: 30000,
    };
    expect(err._tag).toBe("AgentTimeout");
    expect(err.message).toBe("exceeded 30s limit");
    if (err._tag === "AgentTimeout") {
      expect(err.duration_ms).toBe(30000);
    }
  });

  it("constructs AgentCrash with message and optional cause", () => {
    const err: AgentError = {
      _tag: "AgentCrash",
      message: "segfault in agent",
      cause: new Error("underlying"),
    };
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.cause).toBeInstanceOf(Error);
    }
  });

  it("constructs AgentCrash without cause", () => {
    const err: AgentError = {
      _tag: "AgentCrash",
      message: "unknown crash",
    };
    expect(err._tag).toBe("AgentCrash");
    if (err._tag === "AgentCrash") {
      expect(err.cause).toBeUndefined();
    }
  });

  it("constructs AgentBudgetExceeded with limit and actual", () => {
    const err: AgentError = {
      _tag: "AgentBudgetExceeded",
      limit: 1000,
      actual: 1500,
    };
    expect(err._tag).toBe("AgentBudgetExceeded");
    if (err._tag === "AgentBudgetExceeded") {
      expect(err.limit).toBe(1000);
      expect(err.actual).toBe(1500);
    }
  });

  it("constructs AgentPermissionDenied with resource and message", () => {
    const err: AgentError = {
      _tag: "AgentPermissionDenied",
      resource: "/etc/shadow",
      message: "read access denied",
    };
    expect(err._tag).toBe("AgentPermissionDenied");
    if (err._tag === "AgentPermissionDenied") {
      expect(err.resource).toBe("/etc/shadow");
      expect(err.message).toBe("read access denied");
    }
  });

  it("constructs AgentSpawnFailed with message and optional cause", () => {
    const err: AgentError = {
      _tag: "AgentSpawnFailed",
      message: "bridge unreachable",
      cause: "ECONNREFUSED",
    };
    expect(err._tag).toBe("AgentSpawnFailed");
    if (err._tag === "AgentSpawnFailed") {
      expect(err.cause).toBe("ECONNREFUSED");
    }
  });
});

// ── MockAgentProvider ───────────────────────────────────────────────────────

describe("MockAgentProvider", () => {
  it("returns the correct matched response by prompt content", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("deploy"),
          result: { raw: "deployed", cost: { tokens: 50, usd: 0.005, duration_ms: 200 } },
        },
        {
          match: (c) => c.prompt.includes("test"),
          result: { raw: "tested", cost: { tokens: 30, usd: 0.003, duration_ms: 100 } },
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "run deploy please" })),
    );
    const result = await Effect.runPromise(Effect.provide(program, MockAgentProvider(config)));

    expect(result.raw).toBe("deployed");
    expect(result.cost.tokens).toBe(50);
  });

  it("returns fallback response when no match found", async () => {
    const fallback: AgentResult = {
      raw: "fallback response",
      cost: { tokens: 1, usd: 0.0001, duration_ms: 5 },
    };
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("specific"),
          result: okResult,
        },
      ],
      fallback,
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "something else entirely" })),
    );
    const result = await Effect.runPromise(Effect.provide(program, MockAgentProvider(config)));

    expect(result.raw).toBe("fallback response");
  });

  it("triggers failure via failOn", async () => {
    const config: MockAgentProviderConfig = {
      responses: [],
      failOn: [
        {
          match: (c) => c.prompt.includes("crash"),
          error: { _tag: "AgentCrash", message: "intentional crash" },
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "please crash now" })),
    );

    const exit = await Effect.runPromiseExit(
      Effect.provide(program, MockAgentProvider(config)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value).toMatchObject({
          _tag: "AgentCrash",
          message: "intentional crash",
        });
      }
    }
  });

  it("first matching response wins (ordering)", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("build"),
          result: { raw: "first match", cost: { tokens: 10, usd: 0.001, duration_ms: 10 } },
        },
        {
          match: (c) => c.prompt.includes("build"),
          result: { raw: "second match", cost: { tokens: 20, usd: 0.002, duration_ms: 20 } },
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "build the project" })),
    );
    const result = await Effect.runPromise(Effect.provide(program, MockAgentProvider(config)));

    expect(result.raw).toBe("first match");
  });

  it("returns AgentSpawnFailed when no match and no fallback", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("specific"),
          result: okResult,
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "unrelated prompt" })),
    );

    const exit = await Effect.runPromiseExit(
      Effect.provide(program, MockAgentProvider(config)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value).toMatchObject({
          _tag: "AgentSpawnFailed",
          message: "No mock response matched",
        });
      }
    }
  });

  it("failOn takes precedence over response matches", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("overlap"),
          result: okResult,
        },
      ],
      failOn: [
        {
          match: (c) => c.prompt.includes("overlap"),
          error: { _tag: "AgentTimeout", message: "forced timeout", duration_ms: 5000 },
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "overlap case" })),
    );

    const exit = await Effect.runPromiseExit(
      Effect.provide(program, MockAgentProvider(config)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value).toMatchObject({
          _tag: "AgentTimeout",
          message: "forced timeout",
        });
      }
    }
  });

  it("is deterministic — same config produces same result twice", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: (c) => c.prompt.includes("hello"),
          result: { raw: "hi", cost: { tokens: 5, usd: 0.0005, duration_ms: 25 } },
        },
      ],
    };

    const program = AgentProvider.pipe(
      Effect.flatMap((provider) => provider.execute({ prompt: "hello world" })),
    );
    const layer = MockAgentProvider(config);

    const result1 = await Effect.runPromise(Effect.provide(program, layer));
    const result2 = await Effect.runPromise(Effect.provide(program, layer));

    expect(result1).toEqual(result2);
    expect(result1.raw).toBe("hi");
  });

  it("works with Effect.provide Layer pattern", async () => {
    const config: MockAgentProviderConfig = {
      responses: [
        {
          match: () => true,
          result: minimalResult,
        },
      ],
    };

    const myEffect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const result = yield* provider.execute({ prompt: "anything" });
      return result.raw;
    });

    const output = await Effect.runPromise(
      Effect.provide(myEffect, MockAgentProvider(config)),
    );

    expect(output).toBe("done");
  });
});
