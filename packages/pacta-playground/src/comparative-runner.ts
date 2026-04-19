// SPDX-License-Identifier: Apache-2.0
/**
 * Comparative Runner — runs the same scenario against two agent configs
 * and diffs their behavior, outputs, and resource consumption.
 */

import type { EvalReport, ComparativeReport } from './types.js';
import type { ScenarioBuilder, ScenarioAgentConfig } from './scenario.js';

/**
 * Run a scenario against two agent configurations and produce
 * a comparative report with behavioral and resource diffs.
 */
export async function compareAgents(
  scenarioBuilder: ScenarioBuilder,
  agentA: ScenarioAgentConfig,
  agentB: ScenarioAgentConfig,
): Promise<ComparativeReport> {
  const reportA = await scenarioBuilder.run(agentA);
  const reportB = await scenarioBuilder.run(agentB);

  return buildComparativeReport(scenarioBuilder.name, reportA, reportB);
}

function buildComparativeReport(
  scenarioName: string,
  a: EvalReport,
  b: EvalReport,
): ComparativeReport {
  return {
    scenario: scenarioName,
    agents: [a.agent, b.agent],
    reports: [a, b],
    diff: {
      toolSequenceSame: a.behavioral.sequenceCorrect === b.behavioral.sequenceCorrect &&
        a.behavioral.toolsCorrect === b.behavioral.toolsCorrect,
      toolCountDelta: (b.resources.turns) - (a.resources.turns),
      tokenDelta: b.resources.tokens - a.resources.tokens,
      costDelta: b.resources.cost - a.resources.cost,
      turnsDelta: b.resources.turns - a.resources.turns,
      durationDelta: b.resources.durationMs - a.resources.durationMs,
      bothCorrect: a.behavioral.toolsCorrect && b.behavioral.toolsCorrect,
      bothSchemaValid: a.output.schemaValid && b.output.schemaValid,
    },
  };
}
