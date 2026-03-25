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

// Tool provider port
export type { ToolProvider, ToolDefinition, ToolResult } from './ports/tool-provider.js';

// Memory port
export type { MemoryPort, MemoryEntry, AgentNote, NoteFilter } from './ports/memory-port.js';

// Context policy
export type { ContextPolicy } from './context/context-policy.js';

// Reasoning policy
export type { ReasoningPolicy, AgentExample } from './reasoning/reasoning-policy.js';

// Composition engine
export { createAgent, CapabilityError } from './engine/create-agent.js';
export type { CreateAgentOptions, Agent } from './engine/create-agent.js';

// Middleware
export { budgetEnforcer, BudgetExhaustedError } from './middleware/budget-enforcer.js';
export type { BudgetState } from './middleware/budget-enforcer.js';
export { outputValidator } from './middleware/output-validator.js';
