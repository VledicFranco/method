/**
 * Runtime error union type.
 *
 * Each variant carries a discriminant `_tag` for use with Effect.catchTag.
 * These represent all the ways a methodology execution can fail at the
 * step, gate, parse, agent, axiom, or safety level.
 *
 * @see PRD 021 §12.1 — RuntimeError
 */

import type { SafetyBounds } from "../methodology/methodology.js";

// ── Error variants ──

/** A step's precondition predicate evaluated to false. */
export type PreconditionError = {
  readonly _tag: "PreconditionError";
  readonly stepId: string;
  readonly message: string;
};

/** A step's postcondition predicate evaluated to false after execution. */
export type PostconditionError = {
  readonly _tag: "PostconditionError";
  readonly stepId: string;
  readonly message: string;
  readonly retryable: boolean;
};

/** A gate check failed — the step output did not meet the gate criteria. */
export type GateFailure = {
  readonly _tag: "GateFailure";
  readonly gateId: string;
  readonly stepId: string;
  readonly message: string;
  readonly feedback?: string;
};

/** Agent output could not be parsed into the expected state shape. */
export type ParseFailure = {
  readonly _tag: "ParseFailure";
  readonly stepId: string;
  readonly message: string;
  readonly raw?: string;
};

/** The agent (LLM) call itself failed — network, timeout, refusal, etc. */
export type AgentFailure = {
  readonly _tag: "AgentFailure";
  readonly stepId: string;
  readonly message: string;
  readonly cause?: unknown;
};

/** Domain axioms were violated after a state transition. */
export type AxiomViolation = {
  readonly _tag: "AxiomViolation";
  readonly violations: readonly string[];
  readonly stepId: string;
};

/** A safety bound (tokens, cost, time, loops) was exceeded. */
export type SafetyViolation = {
  readonly _tag: "SafetyViolation";
  readonly bound: keyof SafetyBounds;
  readonly limit: number;
  readonly actual: number;
};

// ── Union ──

/** Union of all runtime errors. Each has _tag for Effect.catchTag. */
export type RuntimeError =
  | PreconditionError
  | PostconditionError
  | GateFailure
  | ParseFailure
  | AgentFailure
  | AxiomViolation
  | SafetyViolation;
