/**
 * Assertion helpers for cognitive composition test verification.
 *
 * Each helper throws a descriptive error on failure, compatible
 * with any test runner (node:test, vitest, etc.).
 */

import type {
  MonitoringSignal,
  ControlDirective,
  ReadonlyWorkspaceSnapshot,
  WorkspaceEntry,
  CognitiveEvent,
} from '@method/pacta';

import type { RecordingModule } from './recording-module.js';

// ── assertModuleStepCalled ──────────────────────────────────────

/**
 * Assert that the module's step() was called exactly N times.
 *
 * @param module - The RecordingModule to inspect
 * @param expectedCount - Expected number of step invocations
 */
export function assertModuleStepCalled(
  module: RecordingModule<unknown, unknown, unknown, MonitoringSignal, ControlDirective>,
  expectedCount: number,
): void {
  if (module.stepCount !== expectedCount) {
    throw new Error(
      `assertModuleStepCalled: expected ${expectedCount} step invocations on module '${module.id}', ` +
      `got ${module.stepCount}`
    );
  }
}

// ── assertMonitoringSignalEmitted ───────────────────────────────

/**
 * Assert that at least one step produced a monitoring signal matching the predicate.
 *
 * Inspects all monitoring signals collected from step results returned by the
 * RecordingModule. The module tracks these automatically via `returnedSignals`.
 *
 * @param module - The RecordingModule to inspect
 * @param predicate - A function that returns true for a matching signal
 */
export function assertMonitoringSignalEmitted<
  Mu extends MonitoringSignal,
>(
  module: RecordingModule<unknown, unknown, unknown, Mu, ControlDirective>,
  predicate: (mu: Mu) => boolean,
): void {
  if (module.stepCount === 0) {
    throw new Error(
      `assertMonitoringSignalEmitted: module '${module.id}' was never called — no signals to inspect`
    );
  }

  const signals = module.returnedSignals;

  if (signals.length === 0) {
    throw new Error(
      `assertMonitoringSignalEmitted: module '${module.id}' has no returned monitoring signals to inspect`
    );
  }

  const found = signals.some(predicate);
  if (!found) {
    throw new Error(
      `assertMonitoringSignalEmitted: no monitoring signal from module '${module.id}' matched the predicate. ` +
      `${signals.length} signal(s) were emitted.`
    );
  }
}

// ── assertWorkspaceContains ─────────────────────────────────────

/**
 * Assert that the workspace snapshot contains at least one entry matching the predicate.
 *
 * @param snapshot - A readonly workspace snapshot
 * @param predicate - A function that returns true for a matching entry
 */
export function assertWorkspaceContains(
  snapshot: ReadonlyWorkspaceSnapshot,
  predicate: (entry: Readonly<WorkspaceEntry>) => boolean,
): void {
  const found = snapshot.some(predicate);
  if (!found) {
    throw new Error(
      `assertWorkspaceContains: no workspace entry matched the predicate. ` +
      `Snapshot contains ${snapshot.length} entries.`
    );
  }
}

// ── assertCyclePhaseOrder ───────────────────────────────────────

/**
 * Assert that CognitiveCyclePhase events fired in the expected order.
 *
 * Extracts all 'cognitive:cycle_phase' events from the events array and
 * checks that the phase names appear in the expected order.
 *
 * @param events - Array of CognitiveEvent objects
 * @param expectedPhases - Ordered list of expected phase names
 */
export function assertCyclePhaseOrder(
  events: CognitiveEvent[],
  expectedPhases: string[],
): void {
  const phaseEvents = events.filter(
    (e): e is Extract<CognitiveEvent, { type: 'cognitive:cycle_phase' }> =>
      e.type === 'cognitive:cycle_phase'
  );

  const actualPhases = phaseEvents.map(e => e.phase);

  if (actualPhases.length < expectedPhases.length) {
    throw new Error(
      `assertCyclePhaseOrder: expected ${expectedPhases.length} phase events [${expectedPhases.join(', ')}], ` +
      `got ${actualPhases.length} [${actualPhases.join(', ')}]`
    );
  }

  // Check exact match of phase sequence
  for (let i = 0; i < expectedPhases.length; i++) {
    if (i >= actualPhases.length || actualPhases[i] !== expectedPhases[i]) {
      throw new Error(
        `assertCyclePhaseOrder: at index ${i}, expected phase '${expectedPhases[i]}', ` +
        `got '${actualPhases[i] ?? '<missing>'}'. ` +
        `Full sequence: [${actualPhases.join(', ')}]`
      );
    }
  }
}
