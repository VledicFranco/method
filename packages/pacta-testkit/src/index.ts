// @method/pacta-testkit — verification affordances for Pacta agents
// RecordingProvider, builders, assertions, cognitive helpers

// Recording provider
export { RecordingProvider } from './recording-provider.js';
export type { RecordedToolCall, RecordedTurn, Recording, ScriptedResponse } from './recording-provider.js';

// Mock tool provider
export { MockToolProvider } from './mock-tool-provider.js';
export type { MockToolConfig } from './mock-tool-provider.js';

// Builders
export { pactBuilder, agentRequestBuilder, PactBuilder, AgentRequestBuilder } from './builders.js';

// Assertions
export {
  assertToolsCalled,
  assertToolsCalledUnordered,
  assertBudgetUnder,
  assertOutputMatches,
} from './assertions.js';
export type { BudgetLimits } from './assertions.js';

// Cognitive — RecordingModule
export { RecordingModule } from './recording-module.js';
export type { RecordedStepInvocation } from './recording-module.js';

// Cognitive — Builders
export {
  CognitiveModuleBuilder,
  cognitiveModuleBuilder,
  WorkspaceBuilder,
  workspaceBuilder,
  CycleConfigBuilder,
  cycleConfigBuilder,
  DualStoreBuilder,
  dualStoreBuilder,
} from './cognitive-builders.js';

// Cognitive — Assertions
export {
  assertModuleStepCalled,
  assertMonitoringSignalEmitted,
  assertWorkspaceContains,
  assertCyclePhaseOrder,
  assertConsolidationResult,
  assertEpisodicStoreContains,
  assertSemanticStoreContains,
  assertActivationAboveThreshold,
} from './cognitive-assertions.js';
