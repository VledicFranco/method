// SPDX-License-Identifier: Apache-2.0
/**
 * Plugin interface for conformance checks — S8 §5.5 frozen.
 *
 * Future surface plugins (S4/S5/S6/S7/S9) implement this interface. The runner
 * orchestrates plugins — it knows nothing about specific surfaces.
 */

import type { FixtureId, ConformanceFixture } from './fixtures/index.js';
import type { MockCortexCtx, CallRecorder } from './mock-cortex-ctx.js';
import type { FixtureRunResult, CheckVerdict } from './compliance-report.js';

// Structural mirror — see cortex-types.ts. Duplicated rather than imported
// to keep the pacta-testkit .d.ts free of transitive project references.
import type { MethodAgentResult } from './cortex-types.js';

export interface PluginRunInput {
  readonly fixture: ConformanceFixture;
  readonly fixtureRun: Omit<FixtureRunResult, 'failedCheckIds' | 'passed'>;
  readonly ctx: MockCortexCtx;
  readonly recorder: CallRecorder;
  readonly agentResult?: MethodAgentResult<unknown>;
  readonly invocationError?: Error;
}

export interface ConformancePlugin {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly requiresFixtures?: ReadonlyArray<FixtureId> | '*';
  readonly required: boolean;
  run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>>;
}

/**
 * Plugin ids that {@link runCortexAgentConformance} requires to be present in
 * the caller-supplied plugin list. Tightening this set is a MAJOR bump per
 * S8 §10.
 */
export const DEFAULT_REQUIRED_PLUGIN_IDS: ReadonlyArray<string> = [
  's1-method-agent-port',
  's3-service-adapters',
];
