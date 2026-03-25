// @method/pacta-testkit — verification affordances for Pacta agents
// RecordingProvider, builders, assertions

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
