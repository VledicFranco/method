/**
 * Prompt<A> — Composable prompt algebra.
 *
 * A Prompt is a pure function from context A to instruction text.
 * This is the typed form of guidance_σ from F1-FTH Definition 4.1.
 *
 * Pure by default — no Effect dependency. For prompts requiring world access,
 * use PromptEffect<A, E, R> (typed as (a: A) => Effect<string, E, R>).
 *
 * @see theory-mapping.md — maps to `guidance_σ : Context → Text`
 */

import type { Effect } from "effect";

/** A prompt is a pure function from context to instruction text. */
export class Prompt<A> {
  constructor(public readonly run: (a: A) => string) {}

  /** Sequential composition: run this prompt, then the other. Monoid operation. */
  andThen(other: Prompt<A>): Prompt<A> {
    return new Prompt<A>((a) => {
      const left = this.run(a);
      const right = other.run(a);
      if (!left) return right;
      if (!right) return left;
      return left + "\n\n" + right;
    });
  }

  /**
   * Adapt the context type (contravariant functor).
   *
   * If you have a Prompt<ProjectState> and a function (SessionState => ProjectState),
   * you get a Prompt<SessionState>. This is how you specialize general prompts for
   * specific execution contexts.
   *
   * @example
   * const projectPrompt: Prompt<ProjectState> = ...
   * const sessionPrompt: Prompt<SessionState> = projectPrompt.contramap(s => s.project)
   */
  contramap<B>(f: (b: B) => A): Prompt<B> {
    return new Prompt<B>((b) => this.run(f(b)));
  }

  /** Transform the output string (e.g., wrap in markdown, add prefix). */
  map(f: (s: string) => string): Prompt<A> {
    return new Prompt<A>((a) => f(this.run(a)));
  }

  /** Conditional inclusion: emit only when predicate holds on the context. */
  when(predicate: (a: A) => boolean): Prompt<A> {
    return new Prompt<A>((a) => (predicate(a) ? this.run(a) : ""));
  }

  /** Wrap in a labeled section (markdown heading). */
  section(heading: string): Prompt<A> {
    return this.map((body) => (body ? `## ${heading}\n\n${body}` : ""));
  }

  /** Indent every line of the output. */
  indent(spaces: number = 2): Prompt<A> {
    const pad = " ".repeat(spaces);
    return this.map((s) =>
      s
        .split("\n")
        .map((line) => pad + line)
        .join("\n"),
    );
  }
}

// ── Constructors ──

/** A prompt that always emits the same string, regardless of context. */
export function constant<A = unknown>(value: string): Prompt<A> {
  return new Prompt<A>((_) => value);
}

/** The identity prompt — emits nothing. Monoid identity for andThen. */
export function empty<A = unknown>(): Prompt<A> {
  return new Prompt<A>((_) => "");
}

/** Compose an array of prompts sequentially (monoid fold). */
export function sequence<A>(...prompts: Prompt<A>[]): Prompt<A> {
  return prompts.reduce((acc, p) => acc.andThen(p), empty<A>());
}

/**
 * Conditional prompt: emit `then` if predicate holds, `otherwise` if not.
 *
 * @example
 * const warning = cond<State>(
 *   s => s.filesChanged > 10,
 *   constant("This is a large change — review carefully."),
 * )
 */
export function cond<A>(
  predicate: (a: A) => boolean,
  then: Prompt<A>,
  otherwise: Prompt<A> = empty<A>(),
): Prompt<A> {
  return new Prompt<A>((a) => (predicate(a) ? then.run(a) : otherwise.run(a)));
}

/**
 * Select a prompt based on context (pattern matching).
 * First matching branch wins, fallback if none match.
 */
export function match<A>(
  branches: Array<{ when: (a: A) => boolean; then: Prompt<A> }>,
  fallback: Prompt<A> = empty<A>(),
): Prompt<A> {
  return new Prompt<A>((a) => {
    for (const branch of branches) {
      if (branch.when(a)) return branch.then.run(a);
    }
    return fallback.run(a);
  });
}

/** A prompt built from a tagged template literal with context interpolation. */
export function template<A>(
  strings: TemplateStringsArray,
  ...keys: ((a: A) => string)[]
): Prompt<A> {
  return new Prompt<A>((a) =>
    strings.reduce((acc, str, i) => acc + str + (keys[i] ? keys[i](a) : ""), ""),
  );
}

/** Effectful prompt variant — for prompts that need world access. */
export type PromptEffect<A, E, R> = (a: A) => Effect.Effect<string, E, R>;
