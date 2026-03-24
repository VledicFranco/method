/**
 * Tests for testkit providers — RecordingProvider, SequenceProvider.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { AgentProvider, type AgentResult } from "../../index.js";
import { RecordingProvider, SequenceProvider, silentProvider } from "../index.js";

describe("RecordingProvider", () => {
  it("records commissions and matching responses", async () => {
    const { layer, recordings } = RecordingProvider({
      responses: [
        {
          match: (c) => c.prompt.includes("hello"),
          result: { raw: "world", cost: { tokens: 10, usd: 0.001, duration_ms: 100 } },
        },
      ],
      fallback: { raw: "fallback", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
    });

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const r1 = yield* provider.execute({ prompt: "say hello" });
      const r2 = yield* provider.execute({ prompt: "something else" });
      return [r1, r2];
    });

    const [r1, r2] = await Effect.runPromise(effect.pipe(Effect.provide(layer)));

    expect(r1.raw).toBe("world");
    expect(r2.raw).toBe("fallback");
    expect(recordings).toHaveLength(2);
    expect(recordings[0].commission.prompt).toBe("say hello");
    expect(recordings[0].result!.raw).toBe("world");
    expect(recordings[1].commission.prompt).toBe("something else");
    expect(recordings[1].result!.raw).toBe("fallback");
  });

  it("records failOn errors", async () => {
    const { layer, recordings } = RecordingProvider({
      responses: [],
      failOn: [
        {
          match: (c) => c.prompt.includes("crash"),
          error: { _tag: "AgentCrash", message: "test crash" },
        },
      ],
    });

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      return yield* provider.execute({ prompt: "crash please" });
    });

    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    expect(recordings).toHaveLength(1);
    expect(recordings[0].error).not.toBeNull();
    expect(recordings[0].error!._tag).toBe("AgentCrash");
    expect(recordings[0].result).toBeNull();
  });
});

describe("SequenceProvider", () => {
  it("returns responses in order", async () => {
    const responses: AgentResult[] = [
      { raw: "first", cost: { tokens: 10, usd: 0.001, duration_ms: 100 } },
      { raw: "second", cost: { tokens: 20, usd: 0.002, duration_ms: 200 } },
    ];

    const { layer, recordings } = SequenceProvider(responses);

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const r1 = yield* provider.execute({ prompt: "a" });
      const r2 = yield* provider.execute({ prompt: "b" });
      return [r1, r2];
    });

    const [r1, r2] = await Effect.runPromise(effect.pipe(Effect.provide(layer)));

    expect(r1.raw).toBe("first");
    expect(r2.raw).toBe("second");
    expect(recordings).toHaveLength(2);
  });

  it("falls back when sequence exhausted", async () => {
    const fallback: AgentResult = { raw: "fallback", cost: { tokens: 0, usd: 0, duration_ms: 0 } };
    const { layer } = SequenceProvider(
      [{ raw: "only", cost: { tokens: 1, usd: 0, duration_ms: 0 } }],
      fallback,
    );

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const r1 = yield* provider.execute({ prompt: "a" });
      const r2 = yield* provider.execute({ prompt: "b" });
      return [r1, r2];
    });

    const [r1, r2] = await Effect.runPromise(effect.pipe(Effect.provide(layer)));

    expect(r1.raw).toBe("only");
    expect(r2.raw).toBe("fallback");
  });

  it("fails when exhausted with no fallback", async () => {
    const { layer } = SequenceProvider([]);

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      return yield* provider.execute({ prompt: "a" });
    });

    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
  });
});

describe("silentProvider", () => {
  it("fails with clear error when agent step invokes it", async () => {
    const layer = silentProvider();

    const effect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      return yield* provider.execute({ prompt: "anything" });
    });

    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provide(layer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const error = result.left as { _tag: string; message: string };
      expect(error._tag).toBe("AgentSpawnFailed");
      expect(error.message).toContain("silentProvider");
      expect(error.message).toContain("no configured responses");
    }
  });
});
