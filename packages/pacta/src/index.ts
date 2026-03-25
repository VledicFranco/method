// ── Pacta — Modular Agent SDK ─────────────────────────────────────
//
// The pact is the core abstraction: a typed contract declaring how
// an agent executes, what it may consume, what shape its output takes,
// and what capabilities it has access to.
//
// Pact = declarative constraints (data).
// Ports = runtime implementations (behavior).
// createAgent() binds ports to a pact.

// Core pact types
export type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from './pact.js';

// Execution modes (streaming is orthogonal — see Pact.streaming)
export type {
  ExecutionMode,
  OneshotMode,
  ResumableMode,
  PersistentMode,
  StreamOptions,
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
  AgentThinking,
  AgentToolUse,
  AgentToolResult,
  AgentTurnComplete,
  AgentContextCompacted,
  AgentReflection,
  AgentBudgetWarning,
  AgentBudgetExhausted,
  AgentError,
  AgentCompleted,
} from './events.js';

// Provider port (base + optional capabilities)
export type {
  AgentProvider,
  Streamable,
  Resumable,
  Killable,
  Lifecycle,
  ProviderCapabilities,
} from './ports/agent-provider.js';
