/**
 * Measure<S> — Success profile and progress ordering.
 *
 * F1-FTH Definition 5.2 (ProgressOrder) and 5.3 (Measure).
 */

/** Progress preorder — design artifact specified alongside the objective (Def 5.2). */
export type ProgressOrder<S> = {
  /** Negative = a closer to O, 0 = equal, positive = b closer. */
  readonly compare: (a: S, b: S) => number;
};

/** A measure over the state space. Def 5.3: μ : Mod(D) → ℝ. */
export type Measure<S> = {
  readonly id: string;
  readonly name: string;
  readonly compute: (state: S) => number;
  readonly range: readonly [number, number];
  readonly terminal: number;
  readonly order?: ProgressOrder<S>;
};
