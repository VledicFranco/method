/**
 * MockToolProvider — implements ToolProvider with scripted results.
 *
 * Register tool definitions and scripted responses. When execute() is
 * called, returns the next scripted response for that tool name.
 * Throws if a tool is called with no remaining responses.
 */

import type { ToolProvider, ToolDefinition, ToolResult } from '@method/pacta';

export interface MockToolConfig {
  definition: ToolDefinition;
  responses: ToolResult[];
}

export class MockToolProvider implements ToolProvider {
  private _tools = new Map<string, MockToolConfig>();
  private _callLog: Array<{ name: string; input: unknown; result: ToolResult }> = [];

  /** Register a tool with its scripted responses */
  addTool(definition: ToolDefinition, ...responses: ToolResult[]): this {
    this._tools.set(definition.name, { definition, responses: [...responses] });
    return this;
  }

  /** Get the call log for inspection */
  get callLog(): ReadonlyArray<{ name: string; input: unknown; result: ToolResult }> {
    return this._callLog;
  }

  /** Reset all tools and call history */
  reset(): void {
    this._tools.clear();
    this._callLog = [];
  }

  list(): ToolDefinition[] {
    return Array.from(this._tools.values()).map(t => t.definition);
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const config = this._tools.get(name);
    if (!config) {
      throw new Error(`MockToolProvider: unknown tool '${name}'. Registered: [${Array.from(this._tools.keys()).join(', ')}]`);
    }

    const response = config.responses.shift();
    if (!response) {
      throw new Error(
        `MockToolProvider: no remaining responses for tool '${name}'. ` +
        `Add more responses via addTool() or ensure the test doesn't call it more than expected.`
      );
    }

    this._callLog.push({ name, input, result: response });
    return response;
  }
}
