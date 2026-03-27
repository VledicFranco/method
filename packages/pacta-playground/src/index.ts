// @method/pacta-playground — simulated agent evaluation environment
// Scenario runner, virtual FS, scripted tools, comparative eval

// Types
export type { FidelityLevel, EvalReport, ComparativeReport, ScenarioAssertion } from './types.js';

// Virtual tool provider (Tier 3)
export { VirtualToolProvider } from './virtual-tool-provider.js';

// Scripted tool provider (Tier 2)
export { ScriptedToolProvider } from './scripted-tool-provider.js';
export type { InputMatcher, ScriptedRule } from './scripted-tool-provider.js';

// Scenario builder and helpers
export {
  ScenarioBuilder,
  scenario,
  filesystem,
  tools,
  toolProvider,
  fidelity,
  prompt,
  toolsCalled,
  outputMatches,
  tokensBelow,
} from './scenario.js';
export type { ScenarioGiven, ScenarioWhen, ScenarioAgentConfig } from './scenario.js';

// Comparative runner
export { compareAgents } from './comparative-runner.js';

// Cognitive scenario DSL
export {
  CognitiveScenarioBuilder,
  cognitiveScenario,
  RecordingModule,
  cyclePhaseOrder,
  monitorIntervened,
  workspaceSize,
  moduleStepCount,
} from './cognitive-scenario.js';
export type {
  CognitiveAssertion,
  CognitiveAssertionResult,
  CognitiveScenarioResult,
} from './cognitive-scenario.js';
