/**
 * provider/ — Agent provider implementations.
 *
 * AgentProvider: port interface for dispatching step prompts to LLM agents.
 * MockProvider: in-memory stub provider for tests.
 * BridgeProvider: dispatches to the bridge HTTP server (production).
 * SpawnClaude / ClaudeHeadless: spawn claude CLI for headless execution.
 * StructuredProvider: wraps any provider with Zod output validation + retry.
 */

export * from './agent-provider.js';
export * from './mock-provider.js';
export * from './bridge-provider.js';
export * from './spawn-claude.js';
export * from './claude-headless.js';
export * from './structured-provider.js';
