// @method/pacta-provider-claude-cli — Claude CLI AgentProvider
// claudeCliProvider(), simpleCodeAgent

// Provider factory
export { claudeCliProvider } from './claude-cli-provider.js';
export type { ClaudeCliProviderOptions, ClaudeCliProvider } from './claude-cli-provider.js';

// Pre-assembled agent
export { simpleCodeAgent } from './simple-code-agent.js';

// CLI executor (for advanced usage / custom providers)
export { executeCli, buildCliArgs } from './cli-executor.js';
export type { CliArgs, CliResult, SpawnFn, ExecutorOptions } from './cli-executor.js';
export { CliTimeoutError, CliSpawnError, CliExecutionError } from './cli-executor.js';
