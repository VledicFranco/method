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
export type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport, RecoveryIntent } from './pact.js';

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

// Memory port (v2 — PRD 031, v3 — PRD 036)
export type {
  MemoryPort,
  MemoryPortV2,
  MemoryPortV3,
  MemoryEntry,
  AgentNote,
  NoteFilter,
  EpistemicType,
  FactCard,
  SearchOptions,
  EpisodicEntry,
  SemanticEntry,
  DualStoreConfig,
  ActivationConfig,
  ConsolidationConfig,
  ConsolidationResult,
} from './ports/memory-port.js';
export { InMemoryMemory, cosineSimilarity, reciprocalRankFusion } from './ports/memory-impl.js';
export type { InMemoryMemoryOptions } from './ports/memory-impl.js';

// JSONL persistence (PRD 031, Phase 5)
export { JsonlMemoryStore } from './ports/memory-persistence.js';

// Embedding port (PRD 031)
export type { EmbeddingPort } from './ports/embedding-port.js';

// Context policy + managers
export type { ContextPolicy } from './context/context-policy.js';
export type { ContextMiddleware } from './context/context-middleware.js';
export { compactionManager } from './context/compaction-manager.js';
export { noteTakingManager } from './context/note-taking-manager.js';
export { subagentDelegator } from './context/subagent-delegator.js';
export { systemPromptBudgetTracker } from './context/system-prompt-budget-tracker.js';

// Reasoning policy + strategies
export type { ReasoningPolicy, AgentExample } from './reasoning/reasoning-policy.js';
export type { ReasonerMiddleware } from './reasoning/reasoner-middleware.js';
export { reactReasoner, THINK_TOOL } from './reasoning/react-reasoner.js';
export { reflexionReasoner } from './reasoning/reflexion-reasoner.js';
export { fewShotInjector } from './reasoning/few-shot-injector.js';
export { effortMapper, getEffortParams } from './reasoning/effort-mapper.js';
export type { EffortParams } from './reasoning/effort-mapper.js';

// Composition engine
export { createAgent, CapabilityError } from './engine/create-agent.js';
export type { CreateAgentOptions, Agent, AgentState } from './engine/create-agent.js';

// Middleware
export { budgetEnforcer, BudgetExhaustedError } from './middleware/budget-enforcer.js';
export type { BudgetState } from './middleware/budget-enforcer.js';
export { outputValidator } from './middleware/output-validator.js';

// Reference agents
export type { ReferenceAgent, ReferenceAgentConfig, ReferenceAgentPactOverrides } from './agents/reference-agent.js';
export { createReferenceAgent } from './agents/reference-agent.js';
export { codeAgent } from './agents/code-agent.js';
export { researchAgent } from './agents/research-agent.js';
export { reviewAgent } from './agents/review-agent.js';

// Cognitive composition (Phase 2 — PRD 030)
export * from './cognitive/index.js';
