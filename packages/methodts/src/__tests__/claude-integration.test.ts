// SPDX-License-Identifier: Apache-2.0
/**
 * ClaudeHeadless integration test (requires real claude binary).
 *
 * Skipped by default — only runs manually via `npm run test:integration`.
 * Validates that the ClaudeHeadlessProvider can execute a real prompt
 * against the Claude CLI and return a valid AgentResult.
 *
 * @see PRD 021 Component 13 — ClaudeHeadlessProvider
 * @see WU-7.3 — SC8 integration test
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { ClaudeHeadlessProvider } from "../provider/claude-headless.js";
import { AgentProvider } from "../provider/agent-provider.js";

describe.skip("ClaudeHeadless integration (requires claude binary)", () => {
  it("executes a simple prompt and returns result", async () => {
    const provider = ClaudeHeadlessProvider({ model: "haiku", workdir: "." });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const agent = yield* AgentProvider;
        return yield* agent.execute({ prompt: 'Return exactly: {"status":"ok"}' });
      }).pipe(Effect.provide(provider)),
    );

    expect(result.raw).toContain("ok");
    expect(result.cost.usd).toBeGreaterThanOrEqual(0);
  });

  it("respects model configuration", async () => {
    const provider = ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 1,
      workdir: ".",
      timeoutMs: 60000,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const agent = yield* AgentProvider;
        return yield* agent.execute({ prompt: "Reply with exactly: hello" });
      }).pipe(Effect.provide(provider)),
    );

    expect(result.raw).toBeDefined();
    expect(typeof result.raw).toBe("string");
    expect(result.cost.duration_ms).toBeGreaterThan(0);
  });

  it("handles bridge configuration passthrough", async () => {
    const provider = ClaudeHeadlessProvider({
      model: "haiku",
      workdir: ".",
      allowedTools: ["Read"],
      sessionPrefix: "integration-test",
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const agent = yield* AgentProvider;
        return yield* agent.execute({
          prompt: "Return exactly: test",
          bridge: { workdir: "." },
        });
      }).pipe(Effect.provide(provider)),
    );

    expect(result.raw).toBeDefined();
  });
});
