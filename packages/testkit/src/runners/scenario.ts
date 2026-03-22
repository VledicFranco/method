/**
 * Scenario runner — declarative routing trajectory assertions.
 *
 * Define a sequence of states and expected routing decisions,
 * then run all assertions at once.
 */

import { type Methodology, evaluateTransition } from "@method/methodts";

type ScenarioStep<S> =
  | { type: "given"; state: S }
  | { type: "expectsRoute"; label: string }
  | { type: "expectsTermination" }
  | { type: "then"; state: S };

export type ScenarioRunner<S> = {
  /** Set the initial state. */
  given(state: S): ScenarioRunner<S>;
  /** Assert that δ_Φ routes to the named arm at the current state. */
  expectsRoute(label: string): ScenarioRunner<S>;
  /** Assert that δ_Φ terminates (selects null) at the current state. */
  expectsTermination(): ScenarioRunner<S>;
  /** Advance to the next state (simulating what the method would produce). */
  then(state: S): ScenarioRunner<S>;
  /** Execute all assertions. Throws on the first failure with step context. */
  run(): void;
};

/**
 * Create a scenario runner for a methodology.
 *
 * @example
 * ```ts
 * scenario(methodology)
 *   .given(STATES.detected)
 *   .expectsRoute("triage")
 *   .then(STATES.triaged)
 *   .expectsRoute("investigate")
 *   .then(STATES.investigating)
 *   .expectsRoute("mitigate")
 *   .then(STATES.mitigated)
 *   .expectsRoute("resolve")
 *   .then(STATES.resolved)
 *   .expectsTermination()
 *   .run();
 * ```
 */
export function scenario<S>(methodology: Methodology<S>): ScenarioRunner<S> {
  const steps: ScenarioStep<S>[] = [];

  const runner: ScenarioRunner<S> = {
    given(state) {
      steps.push({ type: "given", state });
      return runner;
    },
    expectsRoute(label) {
      steps.push({ type: "expectsRoute", label });
      return runner;
    },
    expectsTermination() {
      steps.push({ type: "expectsTermination" });
      return runner;
    },
    then(state) {
      steps.push({ type: "then", state });
      return runner;
    },
    run() {
      let currentState: S | null = null;
      let stepIndex = 0;

      for (const step of steps) {
        switch (step.type) {
          case "given":
          case "then":
            currentState = step.state;
            break;

          case "expectsRoute": {
            if (currentState === null) {
              throw new ScenarioError(stepIndex, "expectsRoute called before given/then");
            }
            const result = evaluateTransition(methodology, currentState);
            if (!result.firedArm) {
              const armTraces = formatArmTraces(result.armTraces);
              throw new ScenarioError(
                stepIndex,
                `Expected route "${step.label}", but no arm fired\n${armTraces}`,
              );
            }
            if (result.firedArm.label !== step.label) {
              const armTraces = formatArmTraces(result.armTraces);
              throw new ScenarioError(
                stepIndex,
                `Expected route "${step.label}", got "${result.firedArm.label}"\n${armTraces}`,
              );
            }
            break;
          }

          case "expectsTermination": {
            if (currentState === null) {
              throw new ScenarioError(stepIndex, "expectsTermination called before given/then");
            }
            const result = evaluateTransition(methodology, currentState);
            if (result.selectedMethod !== null) {
              const armTraces = formatArmTraces(result.armTraces);
              throw new ScenarioError(
                stepIndex,
                `Expected termination, but arm "${result.firedArm!.label}" fired ` +
                `(selected: ${result.selectedMethod.id})\n${armTraces}`,
              );
            }
            break;
          }
        }
        stepIndex++;
      }
    },
  };

  return runner;
}

function formatArmTraces(armTraces: readonly { label: string; trace: { result: boolean }; fired: boolean }[]): string {
  return "Arm traces:\n" + armTraces
    .map((t) => `  [${t.label}] condition=${t.trace.result} fired=${t.fired}`)
    .join("\n");
}

class ScenarioError extends Error {
  constructor(stepIndex: number, message: string) {
    super(`Scenario step ${stepIndex}: ${message}`);
    this.name = "ScenarioError";
  }
}
