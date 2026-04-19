// SPDX-License-Identifier: Apache-2.0
/**
 * Scenario — declarative scenario definition and runner.
 *
 * Fluent builder for declaring test scenarios:
 *   scenario('name')
 *     .given(filesystem({ ... }))
 *     .given(tools(['Read', 'Grep']))
 *     .when(prompt('Do something'))
 *     .then(toolsCalled(['Read']))
 *     .then(outputMatches(schema))
 *     .then(tokensBelow(5000))
 */

import type {
  Pact,
  AgentRequest,
  AgentResult,
  SchemaDefinition,
} from '@methodts/pacta';
import type { Recording } from '@methodts/pacta-testkit';
import { RecordingProvider } from '@methodts/pacta-testkit';
import { createAgent } from '@methodts/pacta';
import type { ToolProvider } from '@methodts/pacta';
import type { FidelityLevel, EvalReport, ScenarioAssertion } from './types.js';
import { VirtualToolProvider } from './virtual-tool-provider.js';
import { ScriptedToolProvider } from './scripted-tool-provider.js';

// ── Scenario Givens ──────────────────────────────────────────────

export interface ScenarioGiven {
  type: 'filesystem' | 'tools' | 'tool_provider' | 'fidelity';
  files?: Record<string, string>;
  toolNames?: string[];
  toolProvider?: ToolProvider;
  fidelity?: FidelityLevel;
}

/** Given: initial filesystem state (Tier 3) */
export function filesystem(files: Record<string, string>): ScenarioGiven {
  return { type: 'filesystem', files };
}

/** Given: available tool names (for stub tier) */
export function tools(toolNames: string[]): ScenarioGiven {
  return { type: 'tools', toolNames };
}

/** Given: a specific tool provider */
export function toolProvider(provider: ToolProvider): ScenarioGiven {
  return { type: 'tool_provider', toolProvider: provider };
}

/** Given: a fidelity level */
export function fidelity(level: FidelityLevel): ScenarioGiven {
  return { type: 'fidelity', fidelity: level };
}

// ── Scenario When ────────────────────────────────────────────────

export interface ScenarioWhen {
  prompt: string;
  systemPrompt?: string;
}

/** When: the agent receives this prompt */
export function prompt(text: string, systemPrompt?: string): ScenarioWhen {
  return { prompt: text, systemPrompt };
}

// ── Scenario Then (assertions) ───────────────────────────────────

/** Then: these tools should have been called (in order) */
export function toolsCalled(expectedTools: string[]): ScenarioAssertion {
  return { type: 'tools_called', tools: expectedTools };
}

/** Then: the output should match this schema */
export function outputMatches(schema: SchemaDefinition<unknown>): ScenarioAssertion {
  return { type: 'output_matches', schema };
}

/** Then: token usage should be below this limit */
export function tokensBelow(maxTokens: number): ScenarioAssertion {
  return { type: 'tokens_below', maxTokens };
}

// ── Scenario Agent Config ────────────────────────────────────────

export interface ScenarioAgentConfig {
  name: string;
  pact: Pact;
  provider: RecordingProvider;
}

// ── Scenario Builder ─────────────────────────────────────────────

export class ScenarioBuilder {
  private _name: string;
  private _givens: ScenarioGiven[] = [];
  private _when: ScenarioWhen | null = null;
  private _assertions: ScenarioAssertion[] = [];

  constructor(name: string) {
    this._name = name;
  }

  /** Add a given condition */
  given(g: ScenarioGiven): this {
    this._givens.push(g);
    return this;
  }

  /** Set the when (prompt) */
  when(w: ScenarioWhen): this {
    this._when = w;
    return this;
  }

  /** Add an assertion */
  then(assertion: ScenarioAssertion): this {
    this._assertions.push(assertion);
    return this;
  }

  /** Get the scenario name */
  get name(): string {
    return this._name;
  }

  /** Get the scenario assertions */
  get assertions(): readonly ScenarioAssertion[] {
    return this._assertions;
  }

  /** Get the scenario prompt */
  get promptText(): string {
    return this._when?.prompt ?? '';
  }

  /** Build and resolve the tool provider from givens */
  resolveToolProvider(): ToolProvider {
    // Check for explicit tool provider
    const providerGiven = this._givens.find(g => g.type === 'tool_provider');
    if (providerGiven?.toolProvider) {
      return providerGiven.toolProvider;
    }

    // Check for filesystem given → VirtualToolProvider
    const fsGiven = this._givens.find(g => g.type === 'filesystem');
    if (fsGiven?.files) {
      return new VirtualToolProvider(fsGiven.files);
    }

    // Check for tools given → ScriptedToolProvider with stub tools
    const toolsGiven = this._givens.find(g => g.type === 'tools');
    if (toolsGiven?.toolNames) {
      const scripted = new ScriptedToolProvider();
      for (const toolName of toolsGiven.toolNames) {
        scripted.addTool({ name: toolName });
        scripted.givenAny(toolName).thenReturn({ output: `stub: ${toolName} called` });
      }
      return scripted;
    }

    // Default: empty scripted provider
    return new ScriptedToolProvider();
  }

  /** Build the agent request */
  buildRequest(): AgentRequest {
    if (!this._when) {
      throw new Error(`Scenario '${this._name}': no .when() specified`);
    }
    const req: AgentRequest = { prompt: this._when.prompt };
    if (this._when.systemPrompt) req.systemPrompt = this._when.systemPrompt;
    return req;
  }

  /** Run the scenario against an agent config and produce an EvalReport */
  async run(agentConfig: ScenarioAgentConfig): Promise<EvalReport> {
    const toolProv = this.resolveToolProvider();
    const request = this.buildRequest();

    const agent = createAgent({
      pact: agentConfig.pact,
      provider: agentConfig.provider,
      tools: toolProv,
    });

    const result = await agent.invoke(request);

    const recording = agentConfig.provider.lastRecording;

    return buildEvalReport(
      this._name,
      agentConfig.name,
      result,
      recording,
      this._assertions,
    );
  }
}

/** Create a new scenario builder */
export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name);
}

// ── Eval Report Builder ──────────────────────────────────────────

function buildEvalReport(
  scenarioName: string,
  agentName: string,
  result: AgentResult,
  recording: Recording | undefined,
  assertions: readonly ScenarioAssertion[],
): EvalReport {
  const actualToolNames = recording?.toolCalls.map(tc => tc.name) ?? [];

  // Evaluate assertions
  let toolsCorrect = true;
  let sequenceCorrect = true;
  let schemaValid = true;
  let tokensOk = true;

  for (const assertion of assertions) {
    switch (assertion.type) {
      case 'tools_called': {
        const expected = assertion.tools ?? [];
        toolsCorrect = expected.length === actualToolNames.length &&
          expected.every((t, i) => t === actualToolNames[i]);
        sequenceCorrect = toolsCorrect;
        break;
      }
      case 'output_matches': {
        if (assertion.schema) {
          const parsed = assertion.schema.parse(result.output);
          schemaValid = parsed.success;
        }
        break;
      }
      case 'tokens_below': {
        tokensOk = result.usage.totalTokens <= (assertion.maxTokens ?? Infinity);
        break;
      }
    }
  }

  // Detect reasoning patterns
  const thinkingTraces = recording?.thinkingTraces ?? [];
  const thinkToolUsed = actualToolNames.includes('think') || actualToolNames.includes('Think');
  const planDetected = thinkingTraces.some(t =>
    /plan|step|first|then|next/i.test(t)
  );
  const reflectionDetected = thinkingTraces.some(t =>
    /reflect|reconsider|mistake|wrong|correct/i.test(t)
  );

  return {
    scenario: scenarioName,
    agent: agentName,
    behavioral: { toolsCorrect, sequenceCorrect },
    output: { schemaValid },
    resources: {
      tokens: result.usage.totalTokens,
      cost: result.cost.totalUsd,
      turns: result.turns,
      durationMs: result.durationMs,
    },
    reasoning: { planDetected, reflectionDetected, thinkToolUsed },
  };
}
