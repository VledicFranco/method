/**
 * engine/ — Agent execution engine.
 *
 * createAgent(): factory — wires pact + middleware + provider into Agent<TOutput>.
 * Agent<TOutput>: runnable agent — run(provider, input) → Promise<TOutput>.
 * AgentState: per-run execution state (messages, tool calls, output).
 * CapabilityError: thrown when provider lacks pact-required capabilities.
 */

export { createAgent, CapabilityError } from './create-agent.js';
export type { Agent, AgentState, CreateAgentOptions } from './create-agent.js';
