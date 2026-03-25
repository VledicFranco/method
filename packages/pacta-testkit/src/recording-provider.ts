/**
 * RecordingProvider — an AgentProvider that records all interactions.
 *
 * Captures tool calls (name, input, output, timing), token usage per turn,
 * cost per turn, reasoning traces, and the final output + stop reason.
 * Designed for test assertions — not production use.
 */

import type {
  AgentProvider,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
  CostReport,
  AgentEvent,
} from '@method/pacta';

// ── Recorded data structures ────────────────────────────────────

export interface RecordedToolCall {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  toolUseId: string;
}

export interface RecordedTurn {
  turnNumber: number;
  usage: TokenUsage;
  toolCalls: RecordedToolCall[];
  thinkingContent: string[];
}

export interface Recording<T = unknown> {
  /** All events in order */
  events: AgentEvent[];

  /** Tool calls grouped by turn */
  turns: RecordedTurn[];

  /** All tool calls flattened */
  toolCalls: RecordedToolCall[];

  /** All thinking/reasoning content */
  thinkingTraces: string[];

  /** The final result */
  result: AgentResult<T> | null;
}

// ── Scripted response for the provider ──────────────────────────

export interface ScriptedResponse<T = unknown> {
  /** Events to emit (fed into the recording) */
  events?: AgentEvent[];

  /** The result to return from invoke() */
  result: AgentResult<T>;
}

// ── RecordingProvider ───────────────────────────────────────────

export class RecordingProvider implements AgentProvider {
  readonly name = 'recording';

  private _recordings: Recording[] = [];
  private _responses: ScriptedResponse[] = [];
  private _defaultResult: AgentResult | null = null;

  /** Configure a sequence of scripted responses for successive invoke() calls */
  addResponse(response: ScriptedResponse): this {
    this._responses.push(response);
    return this;
  }

  /** Set a default result used when no scripted responses remain */
  setDefaultResult(result: AgentResult): this {
    this._defaultResult = result;
    return this;
  }

  /** Get all recordings */
  get recordings(): readonly Recording[] {
    return this._recordings;
  }

  /** Get the most recent recording */
  get lastRecording(): Recording | undefined {
    return this._recordings[this._recordings.length - 1];
  }

  /** Reset all recordings and scripted responses */
  reset(): void {
    this._recordings = [];
    this._responses = [];
    this._defaultResult = null;
  }

  capabilities(): ProviderCapabilities {
    return {
      modes: ['oneshot', 'resumable', 'persistent'],
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
  }

  async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
    const recording: Recording<T> = {
      events: [],
      turns: [],
      toolCalls: [],
      thinkingTraces: [],
      result: null,
    };

    // Get the next scripted response, or use default
    const scripted = this._responses.shift();
    if (!scripted && !this._defaultResult) {
      throw new Error(
        'RecordingProvider: no scripted response available and no default result set. ' +
        'Call addResponse() or setDefaultResult() before invoke().'
      );
    }

    const response = scripted ?? { result: this._defaultResult! as AgentResult<T> };
    const events = response.events ?? [];

    // Process events to build the recording
    let currentTurn: RecordedTurn | null = null;
    const pendingToolCalls = new Map<string, Partial<RecordedToolCall>>();

    for (const event of events) {
      recording.events.push(event);

      switch (event.type) {
        case 'thinking':
          recording.thinkingTraces.push(event.content);
          if (currentTurn) {
            currentTurn.thinkingContent.push(event.content);
          }
          break;

        case 'tool_use':
          pendingToolCalls.set(event.toolUseId, {
            name: event.tool,
            input: event.input,
            toolUseId: event.toolUseId,
          });
          break;

        case 'tool_result': {
          const pending = pendingToolCalls.get(event.toolUseId);
          if (pending) {
            const call: RecordedToolCall = {
              name: pending.name ?? event.tool,
              input: pending.input,
              output: event.output,
              durationMs: event.durationMs,
              toolUseId: event.toolUseId,
            };
            recording.toolCalls.push(call);
            if (currentTurn) {
              currentTurn.toolCalls.push(call);
            }
            pendingToolCalls.delete(event.toolUseId);
          }
          break;
        }

        case 'turn_complete':
          currentTurn = {
            turnNumber: event.turnNumber,
            usage: event.usage,
            toolCalls: [],
            thinkingContent: [],
          };
          // Assign tool calls that occurred before this turn_complete
          // to this turn (they were already pushed to recording.toolCalls)
          recording.turns.push(currentTurn);
          break;
      }
    }

    recording.result = response.result as AgentResult<T>;
    this._recordings.push(recording as Recording);
    return response.result as AgentResult<T>;
  }
}
