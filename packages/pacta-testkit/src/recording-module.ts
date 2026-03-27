/**
 * RecordingModule — a CognitiveModule that captures all step invocations
 * and plays back scripted responses.
 *
 * Analogous to RecordingProvider but for the cognitive composition algebra.
 * Designed for test assertions — not production use.
 */

import type {
  CognitiveModule,
  ModuleId,
  MonitoringSignal,
  ControlDirective,
  StepResult,
} from '@method/pacta';

// ── Recorded invocation ─────────────────────────────────────────

export interface RecordedStepInvocation<I, S, Kappa extends ControlDirective> {
  input: I;
  state: S;
  control: Kappa;
}

// ── RecordingModule ─────────────────────────────────────────────

export class RecordingModule<
  I,
  O,
  S,
  Mu extends MonitoringSignal,
  Kappa extends ControlDirective,
> implements CognitiveModule<I, O, S, Mu, Kappa> {

  readonly id: ModuleId;

  private _responses: Array<StepResult<O, S, Mu>> = [];
  private _defaultResult: StepResult<O, S, Mu> | null = null;
  private _invocations: Array<RecordedStepInvocation<I, S, Kappa>> = [];
  private _returnedSignals: Mu[] = [];
  private _initialState: S;

  constructor(id: ModuleId, initialStateValue: S) {
    this.id = id;
    this._initialState = initialStateValue;
  }

  /** Queue a scripted response. Responses are consumed FIFO. */
  addStepResponse(result: StepResult<O, S, Mu>): void {
    this._responses.push(result);
  }

  /** Set a fallback result used when the scripted response queue is empty. */
  setDefaultResult(result: StepResult<O, S, Mu>): void {
    this._defaultResult = result;
  }

  /** All recorded step invocations in order. */
  get invocations(): ReadonlyArray<RecordedStepInvocation<I, S, Kappa>> {
    return this._invocations;
  }

  /** All monitoring signals from returned step results, in order. */
  get returnedSignals(): ReadonlyArray<Mu> {
    return this._returnedSignals;
  }

  /** How many times step() has been called. */
  get stepCount(): number {
    return this._invocations.length;
  }

  initialState(): S {
    return this._initialState;
  }

  async step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>> {
    this._invocations.push({ input, state, control });

    const scripted = this._responses.shift();
    if (scripted) {
      this._returnedSignals.push(scripted.monitoring);
      return scripted;
    }

    if (this._defaultResult) {
      this._returnedSignals.push(this._defaultResult.monitoring);
      return this._defaultResult;
    }

    throw new Error(
      `RecordingModule(${this.id}): no scripted response available and no default result set. ` +
      'Call addStepResponse() or setDefaultResult() before step().'
    );
  }
}
