/**
 * Tests for StructuredAgentProvider — prompt injection, JSON parsing,
 * error handling, and integration with mock providers.
 *
 * @see PRD 046 §Wave 3 — Structured Output
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { AgentProvider, AgentResult, AgentError } from "../agent-provider.js";
import {
  createStructuredProvider,
  buildStructuredPrompt,
  parseJsonResponse,
  type JsonSchema,
} from "../structured-provider.js";

// ── Helpers ──

function mockProvider(responses: AgentResult[]): AgentProvider {
  let callIndex = 0;
  return {
    execute: () => {
      if (callIndex >= responses.length) {
        return Effect.fail<AgentError>({
          _tag: "AgentCrash",
          message: "No more mock responses",
        });
      }
      return Effect.succeed(responses[callIndex++]);
    },
  };
}

const testSchema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    value: { type: "number" },
  },
  required: ["name", "value"],
};

// ── buildStructuredPrompt ──

describe("buildStructuredPrompt", () => {
  it("appends schema constraint to prompt", () => {
    const result = buildStructuredPrompt("Generate data", testSchema, "TestObj");
    expect(result).toContain("Generate data");
    expect(result).toContain('"TestObj"');
    expect(result).toContain('"type": "object"');
    expect(result).toContain("Respond ONLY with the JSON object");
  });
});

// ── parseJsonResponse ──

describe("parseJsonResponse", () => {
  it("parses plain JSON", () => {
    const result = parseJsonResponse('{"name": "test", "value": 42}');
    expect(result).toEqual({ name: "test", value: 42 });
  });

  it("strips markdown code fencing", () => {
    const result = parseJsonResponse('```json\n{"name": "test", "value": 42}\n```');
    expect(result).toEqual({ name: "test", value: 42 });
  });

  it("strips bare code fencing (no language tag)", () => {
    const result = parseJsonResponse('```\n{"name": "test"}\n```');
    expect(result).toEqual({ name: "test" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseJsonResponse("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJsonResponse("")).toBeNull();
  });

  it("handles whitespace around JSON", () => {
    const result = parseJsonResponse('  \n  {"x": 1}  \n  ');
    expect(result).toEqual({ x: 1 });
  });
});

// ── createStructuredProvider ──

describe("createStructuredProvider", () => {
  it("returns parsed JSON data on success", async () => {
    const provider = mockProvider([
      { raw: '{"name": "hello", "value": 99}', cost: { tokens: 10, usd: 0.001, duration_ms: 50 } },
    ]);
    const structured = createStructuredProvider(provider);

    const result = await Effect.runPromise(
      structured.executeStructured<{ name: string; value: number }>({
        prompt: "Generate a test object",
        schema: testSchema,
        schemaName: "TestObj",
      }),
    );

    expect(result.data).toEqual({ name: "hello", value: 99 });
    expect(result.raw).toBe('{"name": "hello", "value": 99}');
    expect(result.cost.tokens).toBe(10);
  });

  it("handles markdown-fenced JSON response", async () => {
    const provider = mockProvider([
      { raw: '```json\n{"name": "fenced", "value": 1}\n```', cost: { tokens: 5, usd: 0, duration_ms: 20 } },
    ]);
    const structured = createStructuredProvider(provider);

    const result = await Effect.runPromise(
      structured.executeStructured<{ name: string; value: number }>({
        prompt: "test",
        schema: testSchema,
        schemaName: "Test",
      }),
    );

    expect(result.data).toEqual({ name: "fenced", value: 1 });
  });

  it("fails with AgentCrash on invalid JSON response", async () => {
    const provider = mockProvider([
      { raw: "This is not JSON at all", cost: { tokens: 5, usd: 0, duration_ms: 20 } },
    ]);
    const structured = createStructuredProvider(provider);

    const result = await Effect.runPromise(
      Effect.either(
        structured.executeStructured({
          prompt: "test",
          schema: testSchema,
          schemaName: "Test",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("AgentCrash");
      if (result.left._tag === "AgentCrash") {
        expect(result.left.message).toContain("Structured output parse failed");
      }
    }
  });

  it("propagates underlying provider errors", async () => {
    const failingProvider: AgentProvider = {
      execute: () => Effect.fail<AgentError>({
        _tag: "AgentTimeout",
        message: "Timed out",
        duration_ms: 30000,
      }),
    };
    const structured = createStructuredProvider(failingProvider);

    const result = await Effect.runPromise(
      Effect.either(
        structured.executeStructured({
          prompt: "test",
          schema: testSchema,
          schemaName: "Test",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("AgentTimeout");
    }
  });

  it("preserves cost data from provider", async () => {
    const provider = mockProvider([
      { raw: '{"x": 1}', cost: { tokens: 500, usd: 0.05, duration_ms: 3000 } },
    ]);
    const structured = createStructuredProvider(provider);

    const result = await Effect.runPromise(
      structured.executeStructured<{ x: number }>({
        prompt: "test",
        schema: { type: "object" },
        schemaName: "T",
      }),
    );

    expect(result.cost).toEqual({ tokens: 500, usd: 0.05, duration_ms: 3000 });
  });
});
