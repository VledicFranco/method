// SPDX-License-Identifier: Apache-2.0
/**
 * StructuredAgentProvider — Typed LLM output via JSON schema.
 *
 * Extends AgentProvider with executeStructured<T> that returns typed JSON
 * instead of raw text. The schema is injected into the prompt, and the
 * response is parsed as JSON. Works with any AgentProvider backend.
 *
 * @see PRD 046 §Surfaces — StructuredAgentProvider
 * @see exp-spl-design — evidence that structured output eliminates parser bottleneck
 */

import { Context, Effect } from "effect";
import type { AgentProvider, AgentError } from "./agent-provider.js";

// ── Types ──

/** JSON Schema definition (subset of JSON Schema draft-07). */
export type JsonSchema = {
  readonly type: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly [key: string]: unknown;
};

/** Commission with schema constraint for structured output. */
export type StructuredCommission = {
  readonly prompt: string;
  readonly schema: JsonSchema;
  readonly schemaName: string;
  readonly bridge?: Record<string, unknown>;
  readonly sessionId?: string;
  readonly resumeSessionId?: string;
};

/** Typed result from structured execution. */
export type StructuredResult<T> = {
  readonly data: T;
  readonly raw: string;
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
  };
};

// ── Port interface ──

/**
 * Agent provider with typed JSON output support.
 *
 * Owner: methodts/provider
 * Consumers: methodts/semantic (runAtomic structured path), methodts/runtime
 */
export interface StructuredAgentProvider {
  readonly executeStructured: <T>(
    commission: StructuredCommission,
  ) => Effect.Effect<StructuredResult<T>, AgentError, never>;
}

/** Effect Context.Tag for the StructuredAgentProvider service. */
export const StructuredAgentProvider = Context.GenericTag<StructuredAgentProvider>("StructuredAgentProvider");

// ── Implementation ──

/**
 * Create a StructuredAgentProvider from a regular AgentProvider.
 *
 * Injects the JSON schema into the prompt as a constraint and parses the
 * LLM's text response as JSON. This prompt-engineering approach works with
 * any LLM backend — no native structured output API required.
 *
 * For backends with native structured output (e.g., Anthropic API with
 * response_format), a specialized implementation can bypass prompt injection.
 */
export function createStructuredProvider(
  provider: AgentProvider,
): StructuredAgentProvider {
  return {
    executeStructured: <T>(commission: StructuredCommission) => {
      const schemaPrompt = buildStructuredPrompt(
        commission.prompt,
        commission.schema,
        commission.schemaName,
      );

      return Effect.flatMap(
        provider.execute({
          prompt: schemaPrompt,
          bridge: commission.bridge,
          sessionId: commission.sessionId,
          resumeSessionId: commission.resumeSessionId,
        }),
        (result) => {
          const parsed = parseJsonResponse<T>(result.raw);
          if (parsed === null) {
            return Effect.fail<AgentError>({
              _tag: "AgentCrash",
              message: `Structured output parse failed: response is not valid JSON`,
              cause: result.raw,
            });
          }
          return Effect.succeed<StructuredResult<T>>({
            data: parsed,
            raw: result.raw,
            cost: result.cost,
          });
        },
      );
    },
  };
}

// ── Helpers (exported for testing) ──

/** Build a prompt with JSON schema constraint appended. */
export function buildStructuredPrompt(
  prompt: string,
  schema: JsonSchema,
  schemaName: string,
): string {
  return `${prompt}

You MUST respond with valid JSON matching this schema (name: "${schemaName}"):
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Respond ONLY with the JSON object. No explanation, no markdown fencing, no extra text.`;
}

/** Parse a potentially fenced JSON response. Returns null on failure. */
export function parseJsonResponse<T>(raw: string): T | null {
  let jsonStr = raw.trim();
  // Strip markdown code fencing if present
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}
