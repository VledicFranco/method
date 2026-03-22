/**
 * Step builders — construct Step<S> values with minimal ceremony.
 */

import { Effect } from "effect";
import {
  type Step,
  type StepExecution,
  type Predicate,
  type Prompt,
  type StepContext,
  TRUE,
} from "@method/methodts";

/** Options for building a script step. */
export type ScriptStepOptions<S> = {
  /** Role that executes this step. Defaults to "default". */
  role?: string;
  /** Precondition predicate. Defaults to TRUE. */
  pre?: Predicate<S>;
  /** Postcondition predicate. Defaults to TRUE. */
  post?: Predicate<S>;
  /** State transform function. */
  execute: (state: S) => S;
  /** Tool IDs this step uses. */
  tools?: string[];
};

/**
 * Build a script Step<S> (pure state transform, no LLM).
 *
 * @example
 * ```ts
 * const step = scriptStep<MyState>("pick_item", {
 *   role: "worker",
 *   pre: hasItems,
 *   post: hasCurrent,
 *   execute: s => ({ ...s, current: s.items[0] }),
 * });
 * ```
 */
export function scriptStep<S>(id: string, options: ScriptStepOptions<S>): Step<S> {
  const execution: StepExecution<S> = {
    tag: "script",
    execute: (state: S) => Effect.succeed(options.execute(state)),
  };

  return {
    id,
    name: id,
    role: options.role ?? "default",
    precondition: options.pre ?? (TRUE as Predicate<S>),
    postcondition: options.post ?? (TRUE as Predicate<S>),
    execution,
    ...(options.tools ? { tools: options.tools } : {}),
  };
}

/** Options for building a script step that can fail. */
export type ScriptStepEffectOptions<S> = {
  /** Role that executes this step. Defaults to "default". */
  role?: string;
  /** Precondition predicate. Defaults to TRUE. */
  pre?: Predicate<S>;
  /** Postcondition predicate. Defaults to TRUE. */
  post?: Predicate<S>;
  /** State transform that returns an Effect (can succeed or fail). */
  execute: (state: S) => Effect.Effect<S, { readonly _tag: string; readonly message: string }, never>;
  /** Tool IDs this step uses. */
  tools?: string[];
};

/**
 * Build a script Step<S> whose execution can fail in the Effect sense.
 *
 * Unlike `scriptStep` (which wraps a pure function in Effect.succeed),
 * this accepts an execute function that returns an Effect directly,
 * allowing the step to signal typed failures.
 *
 * @example
 * ```ts
 * const step = scriptStepEffect<MyState>("validate", {
 *   pre: hasData,
 *   post: isValid,
 *   execute: s => s.data.length > 0
 *     ? Effect.succeed({ ...s, valid: true })
 *     : Effect.fail({ _tag: "StepError", message: "No data" }),
 * });
 * ```
 */
export function scriptStepEffect<S>(id: string, options: ScriptStepEffectOptions<S>): Step<S> {
  const execution: StepExecution<S> = {
    tag: "script",
    execute: options.execute as any,
  };

  return {
    id,
    name: id,
    role: options.role ?? "default",
    precondition: options.pre ?? (TRUE as Predicate<S>),
    postcondition: options.post ?? (TRUE as Predicate<S>),
    execution,
    ...(options.tools ? { tools: options.tools } : {}),
  };
}

/** Options for building an agent step. */
export type AgentStepOptions<S> = {
  /** Role that executes this step. Defaults to "default". */
  role?: string;
  /** Precondition predicate. Defaults to TRUE. */
  pre?: Predicate<S>;
  /** Postcondition predicate. Defaults to TRUE. */
  post?: Predicate<S>;
  /** Prompt to render for the agent. */
  prompt: Prompt<StepContext<S>>;
  /** Parse agent output into new state. */
  parse: (raw: string, current: S) => S;
  /** Tool IDs this step uses. */
  tools?: string[];
};

/**
 * Build an agent Step<S> (LLM-backed execution).
 *
 * @example
 * ```ts
 * const step = agentStep<MyState>("analyze", {
 *   prompt: new Prompt(ctx => `Analyze: ${JSON.stringify(ctx.state)}`),
 *   parse: (raw, current) => ({ ...current, analysis: raw }),
 * });
 * ```
 */
export function agentStep<S>(id: string, options: AgentStepOptions<S>): Step<S> {
  const execution: StepExecution<S> = {
    tag: "agent",
    role: options.role ?? "default",
    context: {},
    prompt: options.prompt,
    parse: (raw: string, current: S) => {
      try {
        return Effect.succeed(options.parse(raw, current));
      } catch (e) {
        return Effect.fail({
          _tag: "ParseError" as const,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };

  return {
    id,
    name: id,
    role: options.role ?? "default",
    precondition: options.pre ?? (TRUE as Predicate<S>),
    postcondition: options.post ?? (TRUE as Predicate<S>),
    execution,
    ...(options.tools ? { tools: options.tools } : {}),
  };
}
