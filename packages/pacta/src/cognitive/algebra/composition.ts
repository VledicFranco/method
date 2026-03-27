/**
 * Composition Operators — four operators that produce new cognitive modules
 * from existing ones, plus type-safe compose-time and runtime validation.
 *
 * Operators:
 *   sequential(A, B)            — A's output feeds B's input
 *   parallel(A, B, merge)       — both execute on same input; merge combines
 *   competitive(A, B, selector) — both produce; selector chooses winner
 *   hierarchical(M, T)          — M reads T's monitoring, issues control
 *
 * All operators return CognitiveModule instances with composed type parameters.
 * Runtime CompositionError is thrown when invariants are violated.
 *
 * Grounded in: ACT-R sequential buffer operations, GWT parallel broadcasting,
 * Nelson & Narens hierarchical monitor/control, evolutionary competitive selection.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ModuleId,
} from './module.js';
import { moduleId, CompositionError } from './module.js';

// ── Sequential ─────────────────────────────────────────────────

/**
 * Sequential composition: A >> B.
 *
 * A's output feeds B's input. Abort on first error (if A's step throws, B doesn't run).
 * The composed module's state is [A.state, B.state], monitoring is [A.mu, B.mu],
 * and control is [A.kappa, B.kappa].
 */
export function sequential<
  I,
  Mid,
  O,
  SA,
  SB,
  MuA extends MonitoringSignal,
  MuB extends MonitoringSignal,
  KappaA extends ControlDirective,
  KappaB extends ControlDirective,
>(
  a: CognitiveModule<I, Mid, SA, MuA, KappaA>,
  b: CognitiveModule<Mid, O, SB, MuB, KappaB>,
): CognitiveModule<I, O, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>> {
  const composedId = moduleId(`seq(${a.id},${b.id})`);

  return {
    id: composedId,

    initialState(): [SA, SB] {
      return [a.initialState(), b.initialState()];
    },

    stateInvariant(state: [SA, SB]): boolean {
      const aOk = a.stateInvariant ? a.stateInvariant(state[0]) : true;
      const bOk = b.stateInvariant ? b.stateInvariant(state[1]) : true;
      return aOk && bOk;
    },

    async step(
      input: I,
      state: [SA, SB],
      control: ComposedControl<KappaA, KappaB>,
    ): Promise<StepResult<O, [SA, SB], ComposedMonitoring<MuA, MuB>>> {
      // A runs first — abort on error (exception propagates)
      const resultA = await a.step(input, state[0], control.first);

      // Validate A's state invariant after step
      if (a.stateInvariant && !a.stateInvariant(resultA.state)) {
        throw new CompositionError(
          `State invariant violation in module ${a.id} after sequential step`,
        );
      }

      // B runs with A's output — abort on error (exception propagates)
      const resultB = await b.step(resultA.output, state[1], control.second);

      // Validate B's state invariant after step
      if (b.stateInvariant && !b.stateInvariant(resultB.state)) {
        throw new CompositionError(
          `State invariant violation in module ${b.id} after sequential step`,
        );
      }

      return {
        output: resultB.output,
        state: [resultA.state, resultB.state],
        monitoring: composedMonitoring(resultA.monitoring, resultB.monitoring),
        error: resultA.error ?? resultB.error,
        trace: resultB.trace,
      };
    },
  };
}

// ── Parallel ───────────────────────────────────────────────────

/** Result from one side of a parallel composition — either success or error. */
export type ParallelSideResult<O, Mu extends MonitoringSignal> =
  | { ok: true; output: O; monitoring: Mu }
  | { ok: false; error: unknown };

/** Merge function for parallel composition: combines two outputs into one. */
export type ParallelMerge<OA, OB, O> = (outputA: OA, outputB: OB) => O;

/**
 * Error-aware merge function for parallel composition.
 * Called when at least one side fails.
 */
export type ParallelErrorMerge<OA, OB, O, MuA extends MonitoringSignal, MuB extends MonitoringSignal> = (
  resultA: ParallelSideResult<OA, MuA>,
  resultB: ParallelSideResult<OB, MuB>,
) => O;

/**
 * Parallel composition: A | B.
 *
 * Both execute on same input simultaneously (Promise.all). Merge combines outputs.
 * If one side throws and no errorMerge is provided, the error is rethrown.
 */
export function parallel<
  I,
  OA,
  OB,
  O,
  SA,
  SB,
  MuA extends MonitoringSignal,
  MuB extends MonitoringSignal,
  KappaA extends ControlDirective,
  KappaB extends ControlDirective,
>(
  a: CognitiveModule<I, OA, SA, MuA, KappaA>,
  b: CognitiveModule<I, OB, SB, MuB, KappaB>,
  merge: ParallelMerge<OA, OB, O>,
  errorMerge?: ParallelErrorMerge<OA, OB, O, MuA, MuB>,
): CognitiveModule<I, O, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>> {
  const composedId = moduleId(`par(${a.id},${b.id})`);

  return {
    id: composedId,

    initialState(): [SA, SB] {
      return [a.initialState(), b.initialState()];
    },

    stateInvariant(state: [SA, SB]): boolean {
      const aOk = a.stateInvariant ? a.stateInvariant(state[0]) : true;
      const bOk = b.stateInvariant ? b.stateInvariant(state[1]) : true;
      return aOk && bOk;
    },

    async step(
      input: I,
      state: [SA, SB],
      control: ComposedControl<KappaA, KappaB>,
    ): Promise<StepResult<O, [SA, SB], ComposedMonitoring<MuA, MuB>>> {
      // Run both simultaneously
      const [settledA, settledB] = await Promise.allSettled([
        a.step(input, state[0], control.first),
        b.step(input, state[1], control.second),
      ]);

      const sideA: ParallelSideResult<OA, MuA> = settledA.status === 'fulfilled'
        ? { ok: true, output: settledA.value.output, monitoring: settledA.value.monitoring }
        : { ok: false, error: settledA.reason };

      const sideB: ParallelSideResult<OB, MuB> = settledB.status === 'fulfilled'
        ? { ok: true, output: settledB.value.output, monitoring: settledB.value.monitoring }
        : { ok: false, error: settledB.reason };

      // Both succeeded — use normal merge
      if (sideA.ok && sideB.ok) {
        const stateA = (settledA as PromiseFulfilledResult<StepResult<OA, SA, MuA>>).value.state;
        const stateB = (settledB as PromiseFulfilledResult<StepResult<OB, SB, MuB>>).value.state;

        // Validate state invariants
        if (a.stateInvariant && !a.stateInvariant(stateA)) {
          throw new CompositionError(
            `State invariant violation in module ${a.id} after parallel step`,
          );
        }
        if (b.stateInvariant && !b.stateInvariant(stateB)) {
          throw new CompositionError(
            `State invariant violation in module ${b.id} after parallel step`,
          );
        }

        return {
          output: merge(sideA.output, sideB.output),
          state: [stateA, stateB],
          monitoring: composedMonitoring(sideA.monitoring, sideB.monitoring),
        };
      }

      // At least one failed — use errorMerge if provided
      if (errorMerge) {
        const stateA = settledA.status === 'fulfilled'
          ? settledA.value.state
          : state[0];
        const stateB = settledB.status === 'fulfilled'
          ? settledB.value.state
          : state[1];

        // Build monitoring from whatever succeeded
        const monA = sideA.ok
          ? sideA.monitoring
          : makeErrorMonitoring(a.id) as MuA;
        const monB = sideB.ok
          ? sideB.monitoring
          : makeErrorMonitoring(b.id) as MuB;

        return {
          output: errorMerge(sideA, sideB),
          state: [stateA, stateB],
          monitoring: composedMonitoring(monA, monB),
          error: {
            message: `Parallel composition: ${!sideA.ok ? 'A' : ''}${!sideA.ok && !sideB.ok ? ' and ' : ''}${!sideB.ok ? 'B' : ''} failed`,
            recoverable: true,
            moduleId: composedId,
            phase: 'parallel',
          },
        };
      }

      // No errorMerge — rethrow the first error
      if (!sideA.ok) throw sideA.error;
      throw (sideB as { ok: false; error: unknown }).error;
    },
  };
}

// ── Competitive ────────────────────────────────────────────────

/**
 * Selector state for competitive composition.
 * The selector itself can maintain state and emit a monitoring signal.
 */
export interface CompetitiveSelectorState<SS> {
  selectorState: SS;
}

/**
 * Selector function for competitive composition.
 * Returns 'a' or 'b' to choose which module's output becomes the composed output.
 */
export type CompetitiveSelector<OA, OB, MuA extends MonitoringSignal, MuB extends MonitoringSignal> = (
  outputA: OA,
  outputB: OB,
  muA: MuA,
  muB: MuB,
) => 'a' | 'b';

/**
 * Competitive composition: A <|> B.
 *
 * Both modules produce outputs; a selector function chooses the winner.
 * If one module throws, the other wins by default.
 * If both throw, the composition rethrows.
 */
export function competitive<
  I,
  OA,
  OB,
  SA,
  SB,
  MuA extends MonitoringSignal,
  MuB extends MonitoringSignal,
  KappaA extends ControlDirective,
  KappaB extends ControlDirective,
>(
  a: CognitiveModule<I, OA, SA, MuA, KappaA>,
  b: CognitiveModule<I, OB, SB, MuB, KappaB>,
  selector: CompetitiveSelector<OA, OB, MuA, MuB>,
): CognitiveModule<I, OA | OB, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>> {
  const composedId = moduleId(`comp(${a.id},${b.id})`);

  return {
    id: composedId,

    initialState(): [SA, SB] {
      return [a.initialState(), b.initialState()];
    },

    stateInvariant(state: [SA, SB]): boolean {
      const aOk = a.stateInvariant ? a.stateInvariant(state[0]) : true;
      const bOk = b.stateInvariant ? b.stateInvariant(state[1]) : true;
      return aOk && bOk;
    },

    async step(
      input: I,
      state: [SA, SB],
      control: ComposedControl<KappaA, KappaB>,
    ): Promise<StepResult<OA | OB, [SA, SB], ComposedMonitoring<MuA, MuB>>> {
      const [settledA, settledB] = await Promise.allSettled([
        a.step(input, state[0], control.first),
        b.step(input, state[1], control.second),
      ]);

      const aOk = settledA.status === 'fulfilled';
      const bOk = settledB.status === 'fulfilled';

      // Both failed — rethrow
      if (!aOk && !bOk) {
        throw new CompositionError(
          `Competitive composition: both modules failed. A: ${String(settledA.reason)}, B: ${String(settledB.reason)}`,
        );
      }

      // Only A succeeded
      if (aOk && !bOk) {
        const resultA = settledA.value;
        if (a.stateInvariant && !a.stateInvariant(resultA.state)) {
          throw new CompositionError(
            `State invariant violation in module ${a.id} after competitive step`,
          );
        }
        return {
          output: resultA.output,
          state: [resultA.state, state[1]],
          monitoring: composedMonitoring(resultA.monitoring, makeErrorMonitoring(b.id) as MuB),
        };
      }

      // Only B succeeded
      if (!aOk && bOk) {
        const resultB = settledB.value;
        if (b.stateInvariant && !b.stateInvariant(resultB.state)) {
          throw new CompositionError(
            `State invariant violation in module ${b.id} after competitive step`,
          );
        }
        return {
          output: resultB.output,
          state: [state[0], resultB.state],
          monitoring: composedMonitoring(makeErrorMonitoring(a.id) as MuA, resultB.monitoring),
        };
      }

      // Both succeeded — use selector
      const resultA = (settledA as PromiseFulfilledResult<StepResult<OA, SA, MuA>>).value;
      const resultB = (settledB as PromiseFulfilledResult<StepResult<OB, SB, MuB>>).value;

      // Validate state invariants for both
      if (a.stateInvariant && !a.stateInvariant(resultA.state)) {
        throw new CompositionError(
          `State invariant violation in module ${a.id} after competitive step`,
        );
      }
      if (b.stateInvariant && !b.stateInvariant(resultB.state)) {
        throw new CompositionError(
          `State invariant violation in module ${b.id} after competitive step`,
        );
      }

      const choice = selector(resultA.output, resultB.output, resultA.monitoring, resultB.monitoring);

      const chosenOutput = choice === 'a' ? resultA.output : resultB.output;
      const monitoring = composedMonitoring(resultA.monitoring, resultB.monitoring);

      return {
        output: chosenOutput,
        state: [resultA.state, resultB.state],
        monitoring,
      };
    },
  };
}

// ── Hierarchical ───────────────────────────────────────────────

/**
 * Hierarchical composition: Monitor > Target.
 *
 * Target runs first, producing a monitoring signal. The monitor reads that signal
 * on the *next* step and issues control directives. The composed module maintains
 * lastMonitoring from the target for the monitor to read.
 *
 * Error behavior: target error propagates; monitor error escalates (wraps in CompositionError).
 */
export function hierarchical<
  I,
  OTarget,
  OMonitor,
  STarget,
  SMonitor,
  MuTarget extends MonitoringSignal,
  MuMonitor extends MonitoringSignal,
  KappaTarget extends ControlDirective,
  KappaMonitor extends ControlDirective,
>(
  monitor: CognitiveModule<MuTarget, OMonitor, SMonitor, MuMonitor, KappaMonitor>,
  target: CognitiveModule<I, OTarget, STarget, MuTarget, KappaTarget>,
): CognitiveModule<
  I,
  OTarget,
  HierarchicalState<STarget, SMonitor, MuTarget>,
  ComposedMonitoring<MuTarget, MuMonitor>,
  ComposedControl<KappaTarget, KappaMonitor>
> {
  const composedId = moduleId(`hier(${monitor.id},${target.id})`);

  return {
    id: composedId,

    initialState(): HierarchicalState<STarget, SMonitor, MuTarget> {
      return {
        targetState: target.initialState(),
        monitorState: monitor.initialState(),
        lastMonitoring: undefined,
      };
    },

    stateInvariant(state: HierarchicalState<STarget, SMonitor, MuTarget>): boolean {
      const tOk = target.stateInvariant ? target.stateInvariant(state.targetState) : true;
      const mOk = monitor.stateInvariant ? monitor.stateInvariant(state.monitorState) : true;
      return tOk && mOk;
    },

    async step(
      input: I,
      state: HierarchicalState<STarget, SMonitor, MuTarget>,
      control: ComposedControl<KappaTarget, KappaMonitor>,
    ): Promise<StepResult<
      OTarget,
      HierarchicalState<STarget, SMonitor, MuTarget>,
      ComposedMonitoring<MuTarget, MuMonitor>
    >> {
      // Target runs first
      const targetResult = await target.step(input, state.targetState, control.first);

      // Validate target state invariant
      if (target.stateInvariant && !target.stateInvariant(targetResult.state)) {
        throw new CompositionError(
          `State invariant violation in target module ${target.id} after hierarchical step`,
        );
      }

      // Monitor reacts to the *previous* step's monitoring signal
      // On the first step, lastMonitoring is undefined — we use a no-op signal
      const monitorInput = state.lastMonitoring ?? makeNoopMonitoring(target.id) as MuTarget;

      let monitorMonitoring: MuMonitor;
      let monitorState: SMonitor;

      try {
        const monitorResult = await monitor.step(monitorInput, state.monitorState, control.second);
        monitorMonitoring = monitorResult.monitoring;
        monitorState = monitorResult.state;

        // Validate monitor state invariant
        if (monitor.stateInvariant && !monitor.stateInvariant(monitorState)) {
          throw new CompositionError(
            `State invariant violation in monitor module ${monitor.id} after hierarchical step`,
          );
        }
      } catch (err) {
        if (err instanceof CompositionError) throw err;
        throw new CompositionError(
          `Monitor module ${monitor.id} error escalated: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        output: targetResult.output,
        state: {
          targetState: targetResult.state,
          monitorState,
          lastMonitoring: targetResult.monitoring,
        },
        monitoring: composedMonitoring(targetResult.monitoring, monitorMonitoring),
        error: targetResult.error,
        trace: targetResult.trace,
      };
    },
  };
}

// ── Composed Type Helpers ──────────────────────────────────────

/** Composed monitoring signal — a tuple of two signals. */
export interface ComposedMonitoring<
  MuA extends MonitoringSignal,
  MuB extends MonitoringSignal,
> extends MonitoringSignal {
  first: MuA;
  second: MuB;
}

/** Composed control directive — carries two sub-directives while satisfying ControlDirective. */
export interface ComposedControl<
  KappaA extends ControlDirective,
  KappaB extends ControlDirective,
> extends ControlDirective {
  first: KappaA;
  second: KappaB;
}

/** Hierarchical composition state — target state, monitor state, last monitoring. */
export interface HierarchicalState<STarget, SMonitor, MuTarget extends MonitoringSignal> {
  targetState: STarget;
  monitorState: SMonitor;
  lastMonitoring: MuTarget | undefined;
}

// ── Internal Helpers ───────────────────────────────────────────

function composedMonitoring<
  MuA extends MonitoringSignal,
  MuB extends MonitoringSignal,
>(first: MuA, second: MuB): ComposedMonitoring<MuA, MuB> {
  return {
    source: moduleId(`composed(${first.source},${second.source})`),
    timestamp: Math.max(first.timestamp, second.timestamp),
    first,
    second,
  };
}

function makeErrorMonitoring(source: ModuleId): MonitoringSignal {
  return {
    source,
    timestamp: Date.now(),
  };
}

function makeNoopMonitoring(source: ModuleId): MonitoringSignal {
  return {
    source,
    timestamp: 0,
  };
}
