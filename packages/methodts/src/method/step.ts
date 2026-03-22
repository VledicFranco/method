/**
 * Step<S> — Typed step definition with hybrid execution.
 *
 * F1-FTH Definition 4.1: σ = (pre, post, guidance, tools)
 * Extended with: execution (agent | script), gate, suspension policy.
 */

import type { Effect } from "effect";
import type { Predicate } from "../predicate/predicate.js";
import type { Prompt } from "../prompt/prompt.js";

/** Context assembled for agent steps by the Step Context Protocol (§12.3). */
export type StepContext<S> = {
  readonly state: S;
  readonly world: Readonly<Record<string, string>>;
  readonly insights: Readonly<Record<string, string>>;
  readonly domainFacts: string;
};

/** Context specification — what an agent step needs. */
export type ContextSpec<S> = {
  readonly worldReads?: readonly ContextRead<S>[];
  readonly insightDeps?: readonly string[];
  readonly produceInsight?: { readonly key: string; readonly instruction: string };
  readonly domainFacts?: DomainFactsSpec;
  readonly sufficient?: Predicate<StepContext<S>>;
};

/** A pre-fetched world fragment. */
export type ContextRead<S> = {
  readonly key: string;
  readonly extract: (state: S) => Effect.Effect<string, ExtractionError, WorldServices>;
  readonly maxTokens?: number;
  readonly label?: string;
};

/** Which domain theory elements to render as agent context. */
export type DomainFactsSpec = {
  readonly axioms?: readonly string[] | "all";
  readonly predicates?: readonly string[] | "all";
  readonly sorts?: readonly string[] | "all";
  readonly roleConstraints?: boolean;
  readonly deliveryRules?: readonly string[] | "all";
};

/** Hybrid step execution: agent (LLM) or script (TypeScript). */
export type StepExecution<S> =
  | {
      readonly tag: "agent";
      readonly role: string;
      readonly context: ContextSpec<S>;
      readonly prompt: Prompt<StepContext<S>>;
      readonly parse: (raw: string, current: S) => Effect.Effect<S, ParseError, never>;
      readonly parseInsight?: (raw: string) => string;
    }
  | {
      readonly tag: "script";
      readonly execute: (state: S) => Effect.Effect<S, StepError, WorldServices>;
    };

/** When to yield control to the caller. */
export type SuspensionPolicy<S = any> =
  | "never"
  | "on_failure"
  | "always"
  | { readonly tag: "on_condition"; readonly condition: Predicate<S> };

/** A step in a method's DAG. F1-FTH Definition 4.1. */
export type Step<S> = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly precondition: Predicate<S>;
  readonly postcondition: Predicate<S>;
  readonly execution: StepExecution<S>;
  readonly tools?: readonly string[];
  readonly suspension?: SuspensionPolicy<S>;
};

// ── Error types ──

export type StepError = { readonly _tag: "StepError"; readonly stepId: string; readonly message: string; readonly cause?: unknown };
export type ParseError = { readonly _tag: "ParseError"; readonly message: string; readonly raw?: string };
export type ExtractionError = { readonly _tag: "ExtractionError"; readonly key: string; readonly message: string };

// ── Service types (Phase 1b — placeholders for Effect Layer composition) ──

/** World services required by script steps and extractors. Effect R parameter (intersection). */
export type WorldServices = Record<string, never>; // Placeholder — refined in Phase 1b when CommandService/GitService are defined
