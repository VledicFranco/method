/**
 * InsightStore — In-memory key-value store for cross-step insights.
 *
 * Backed by Effect.Ref for safe concurrent access. Steps can produce
 * insights that later steps depend on, creating an information flow
 * channel across the methodology execution.
 *
 * @see PRD 021 §12.3 — Step Context Protocol, Channel 2
 */

import { Effect, Ref } from "effect";

/** In-memory insight store backed by Effect.Ref. */
export interface InsightStore {
  /** Retrieve an insight by key. Returns undefined if not present. */
  readonly get: (key: string) => Effect.Effect<string | undefined, never, never>;
  /** Store or overwrite an insight at the given key. */
  readonly set: (key: string, value: string) => Effect.Effect<void, never, never>;
  /** Check whether a key exists in the store. */
  readonly has: (key: string) => Effect.Effect<boolean, never, never>;
  /** Return a snapshot of all entries. */
  readonly getAll: () => Effect.Effect<Record<string, string>, never, never>;
}

/** Create a new InsightStore backed by an Effect.Ref. */
export function createInsightStore(
  initial?: Record<string, string>,
): Effect.Effect<InsightStore, never, never> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<Record<string, string>>(initial ?? {});
    return {
      get: (key) => Ref.get(ref).pipe(Effect.map((store) => store[key])),
      set: (key, value) =>
        Ref.update(ref, (store) => ({ ...store, [key]: value })),
      has: (key) => Ref.get(ref).pipe(Effect.map((store) => key in store)),
      getAll: () => Ref.get(ref),
    };
  });
}
