// ── Pacta — Agent Deployment Contracts ────────────────────────────
//
// The pact is the core abstraction: a typed contract declaring how
// an agent executes, what it may consume, what shape its output takes,
// and what capabilities it has access to.

// Core pact types
export type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from './pact.js';

// Execution modes
export type {
  ExecutionMode,
  OneshotMode,
  ResumableMode,
  PersistentMode,
  StreamingMode,
} from './modes/execution-mode.js';

// Budget contracts
export type { BudgetContract } from './budget/budget-contract.js';

// Output contracts
export type {
  OutputContract,
  SchemaDefinition,
  SchemaResult,
} from './output/output-contract.js';

// Scope contracts
export type { ScopeContract } from './scope.js';

// Agent events
export type {
  AgentEvent,
  AgentStarted,
  AgentText,
  AgentToolUse,
  AgentToolResult,
  AgentTurnComplete,
  AgentBudgetWarning,
  AgentBudgetExhausted,
  AgentError,
  AgentCompleted,
} from './events.js';

// Provider port
export type {
  AgentProvider,
  ProviderCapabilities,
} from './ports/agent-provider.js';
