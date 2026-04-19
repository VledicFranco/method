// SPDX-License-Identifier: Apache-2.0
/**
 * Tool Provider — port interface for tool execution.
 *
 * Lists available tools and executes them by name. Concrete
 * implementations may wrap MCP servers, function registries,
 * or scripted responses (for testing).
 */

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolResult {
  output: unknown;
  isError?: boolean;
}

export interface ToolProvider {
  /** List all available tools */
  list(): ToolDefinition[];

  /** Execute a tool by name with the given input */
  execute(name: string, input: unknown): Promise<ToolResult>;
}
