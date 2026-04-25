// SPDX-License-Identifier: Apache-2.0
/**
 * TestCycleRunner — drives a single cognitive module through N cycles
 * and collects queryable trace records — PRD 059.
 *
 * Different from `RecordingModule` (per-component invocation capture):
 * this is a per-module *driver* that wires inputs into successive
 * `step()` calls, threads state, and accumulates a full TestCycleTrace
 * per cycle. Tests assert by `lastSignal(type)`, `countSignals(type)`,
 * `allSignals()`, or by inspecting `traces` directly.
 *
 * @see docs/prds/059-pacta-testkit-diagnostics.md
 */

import type {
  CognitiveModule,
  ControlDirective,
  MonitoringSignal,
} from '@methodts/pacta';

export interface TestCycleTrace {
  /** Zero-based index. */
  readonly cycle: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly signals: readonly MonitoringSignal[];
  readonly stateBefore: unknown;
  readonly stateAfter: unknown;
  readonly durationMs: number;
  readonly error?: string;
}

const NO_CONTROL: ControlDirective = {
  // Minimal control directive — modules that need richer control should
  // pass their own via run/runSingle.
} as unknown as ControlDirective;

export class TestCycleRunner<I, O, S> {
  private readonly module: CognitiveModule<I, O, S, MonitoringSignal, ControlDirective>;
  private state: S;
  private readonly _traces: TestCycleTrace[] = [];

  constructor(module: CognitiveModule<I, O, S, MonitoringSignal, ControlDirective>) {
    this.module = module;
    this.state = module.initialState();
  }

  /** All traces collected so far (newest last). */
  get traces(): readonly TestCycleTrace[] {
    return this._traces;
  }

  /** Current state (after the last cycle, or initial if no cycles run). */
  get currentState(): S {
    return this.state;
  }

  /** Run the module on each input in order; returns the new traces. */
  async run(
    inputs: readonly I[],
    control?: ControlDirective,
  ): Promise<readonly TestCycleTrace[]> {
    const produced: TestCycleTrace[] = [];
    for (const inp of inputs) {
      produced.push(await this.runSingle(inp, control));
    }
    return produced;
  }

  /** Run a single cycle. */
  async runSingle(input: I, control?: ControlDirective): Promise<TestCycleTrace> {
    const ctrl = control ?? NO_CONTROL;
    const cycleIdx = this._traces.length;
    const stateBefore = this.state;
    const start = Date.now();

    let output: unknown = undefined;
    let signals: readonly MonitoringSignal[] = [];
    let stateAfter: S = stateBefore;
    let error: string | undefined;

    try {
      const result = await this.module.step(input, stateBefore, ctrl);
      output = result.output;
      signals = result.monitoring ? [result.monitoring] : [];
      stateAfter = result.state;
      this.state = result.state;
    } catch (e) {
      error = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    }

    const durationMs = Date.now() - start;
    const trace: TestCycleTrace = {
      cycle: cycleIdx,
      input,
      output,
      signals,
      stateBefore,
      stateAfter,
      durationMs,
      error,
    };
    this._traces.push(trace);
    return trace;
  }

  /** Most recent signal of the given type, or undefined. */
  lastSignal(type: string): MonitoringSignal | undefined {
    for (let i = this._traces.length - 1; i >= 0; i--) {
      const t = this._traces[i]!;
      for (let j = t.signals.length - 1; j >= 0; j--) {
        if (signalType(t.signals[j]!) === type) return t.signals[j];
      }
    }
    return undefined;
  }

  /** Count signals of the given type across all traces. */
  countSignals(type: string): number {
    let count = 0;
    for (const t of this._traces) {
      for (const s of t.signals) if (signalType(s) === type) count++;
    }
    return count;
  }

  /** All signals across all cycles, in order. */
  allSignals(): readonly MonitoringSignal[] {
    const out: MonitoringSignal[] = [];
    for (const t of this._traces) {
      for (const s of t.signals) out.push(s);
    }
    return out;
  }

  /** Reset state to initial and clear all traces. */
  reset(): void {
    this._traces.length = 0;
    this.state = this.module.initialState();
  }
}

function signalType(s: MonitoringSignal): string {
  const t = (s as unknown as { type?: unknown }).type;
  return typeof t === 'string' ? t : 'unknown';
}
