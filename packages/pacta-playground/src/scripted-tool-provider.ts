// SPDX-License-Identifier: Apache-2.0
/**
 * ScriptedToolProvider — rule-based tool responses.
 *
 * Given(toolName, inputMatcher) -> return(result).
 * Falls back to error for unmatched calls. Tier 2 (script) fidelity.
 */

import type { ToolProvider, ToolDefinition, ToolResult } from '@methodts/pacta';

// ── Types ────────────────────────────────────────────────────────

export type InputMatcher = (input: unknown) => boolean;

export interface ScriptedRule {
  toolName: string;
  matcher: InputMatcher;
  result: ToolResult;
}

// ── ScriptedToolProvider ─────────────────────────────────────────

export class ScriptedToolProvider implements ToolProvider {
  private _rules: ScriptedRule[] = [];
  private _tools: ToolDefinition[] = [];
  private _callLog: Array<{ name: string; input: unknown; result: ToolResult }> = [];

  /** Register a tool definition (for list()) */
  addTool(definition: ToolDefinition): this {
    this._tools.push(definition);
    return this;
  }

  /** Add a scripted rule: when tool `name` is called and matcher returns true, return result */
  given(toolName: string, matcher: InputMatcher): { thenReturn: (result: ToolResult) => ScriptedToolProvider } {
    return {
      thenReturn: (result: ToolResult) => {
        this._rules.push({ toolName, matcher, result });
        return this;
      },
    };
  }

  /** Convenience: match any input for a tool */
  givenAny(toolName: string): { thenReturn: (result: ToolResult) => ScriptedToolProvider } {
    return this.given(toolName, () => true);
  }

  /** Get the call log for test inspection */
  get callLog(): ReadonlyArray<{ name: string; input: unknown; result: ToolResult }> {
    return this._callLog;
  }

  /** Get the scripted rules */
  get rules(): readonly ScriptedRule[] {
    return this._rules;
  }

  list(): ToolDefinition[] {
    return this._tools;
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    // Find the first matching rule
    for (const rule of this._rules) {
      if (rule.toolName === name && rule.matcher(input)) {
        this._callLog.push({ name, input, result: rule.result });
        return rule.result;
      }
    }

    // No match — return error
    const result: ToolResult = {
      output: `ScriptedToolProvider: no matching rule for tool '${name}' with the given input`,
      isError: true,
    };
    this._callLog.push({ name, input, result });
    return result;
  }
}
