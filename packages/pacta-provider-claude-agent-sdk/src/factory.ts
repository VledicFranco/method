// SPDX-License-Identifier: Apache-2.0
/**
 * `claudeAgentSdkProvider` — direct-mode factory (C-1).
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` in a pacta
 * `AgentProvider`. The SDK owns the inner agentic loop (system prompt,
 * tool execution, turn pacing); this factory is responsible for:
 *
 *   1. Translating the pacta `Pact` into the SDK's `Options` shape
 *      (with cost-suppression defaults — see `pact-to-sdk-options.ts`).
 *   2. Calling the transport's `setup()` to obtain env vars (and a
 *      `teardown()` to release any transport-owned resources).
 *   3. Iterating the SDK's message stream into pacta `AgentEvent`s
 *      and the final `AgentResult`.
 *   4. Releasing transport resources via `teardown()` on every exit
 *      path (success, error, abort).
 *
 * Streaming (`Streamable.stream()`) is stubbed in C-1 and lands in C-3
 * (separate commission, see realize-plan.md).
 */

import { query, type SDKMessage, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

import type {
  AgentProvider,
  Streamable,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  AgentEvent,
  TokenUsage,
  CostReport,
} from '@methodts/pacta';

import { directTransport } from './direct-transport.js';
import { mapSdkMessage, mapUsage, mapCost, emptyUsage } from './event-mapper.js';
import { pactToSdkOptions } from './pact-to-sdk-options.js';
import type { AnthropicSdkTransport } from './transport.js';

// ── Re-exported types ────────────────────────────────────────────

export type { AnthropicSdkTransport };
export { pactToSdkOptions };
export { drainSdkStream };

// ── Provider capabilities ────────────────────────────────────────

const CAPABILITIES: ProviderCapabilities = {
  modes: ['oneshot'],
  streaming: true,
  resumable: false,
  budgetEnforcement: 'client',
  outputValidation: 'client',
  toolModel: 'function',
};

// ── Options ──────────────────────────────────────────────────────

/**
 * S-CLAUDE-SDK-PROVIDER — public surface (PRD §S2).
 *
 * Re-exported from index.ts as well; defined here so the factory and
 * the type live together for navigation purposes.
 */
export interface ClaudeAgentSdkProviderOptions {
  /** Default model (e.g. 'claude-sonnet-4-6'). Overridable per pact. */
  defaultModel?: string;

  /**
   * HTTP transport for SDK API calls. Default: a direct-mode transport
   * built from `apiKey`. Cortex tenants pass `cortexAnthropicTransport(ctx)`.
   * Conforms to S-ANTHROPIC-SDK-TRANSPORT.
   */
  transport?: AnthropicSdkTransport;

  /**
   * API key. Used only when `transport` is unset (direct mode).
   * Falls back to `ANTHROPIC_API_KEY` env var.
   */
  apiKey?: string;

  /**
   * Tool provider. The SDK runs its own tool loop; pacta-supplied tools
   * are passed via the per-pact `scope.allowedTools` whitelist for now.
   * Reserved here for richer integration in a future commission.
   */
  toolProvider?: unknown;

  /**
   * Max agentic turns per invocation. Defaults to
   * `pact.budget?.maxTurns ?? 25`.
   */
  maxTurns?: number;
}

/** The composed provider value. */
export type ClaudeAgentSdkProvider = AgentProvider & Streamable;

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a pacta `AgentProvider` over `@anthropic-ai/claude-agent-sdk`.
 *
 * @param options - Configuration; all fields optional. With no options,
 *   defaults to direct mode reading `ANTHROPIC_API_KEY` from env.
 */
export function claudeAgentSdkProvider(
  options: ClaudeAgentSdkProviderOptions = {},
): ClaudeAgentSdkProvider {
  const transport = options.transport ?? directTransport({ apiKey: options.apiKey });

  return {
    name: 'claude-agent-sdk',

    capabilities(): ProviderCapabilities {
      return CAPABILITIES;
    },

    async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      return invokeOneshot(pact, request, options, transport);
    },

    stream(_pact: Pact, _request: AgentRequest): AsyncIterable<AgentEvent> {
      // Stubbed in C-1; C-3 replaces this with a real implementation.
      // The error here trips at iteration time (not at `stream()` call
      // time), but the SDK consumer pattern is to immediately enter a
      // `for await` so it'll surface promptly.
      return (async function* () {
        throw new Error(
          '[claude-agent-sdk] Streaming lands in C-3 — see ' +
          '.method/sessions/fcd-plan-20260419-2300-pacta-claude-agent-sdk/realize-plan.md',
        );
      })();
    },
  };
}

// ── Oneshot invocation ───────────────────────────────────────────

async function invokeOneshot<T>(
  pact: Pact<T>,
  request: AgentRequest,
  config: ClaudeAgentSdkProviderOptions,
  transport: AnthropicSdkTransport,
): Promise<AgentResult<T>> {
  const startTime = Date.now();

  // 1. Set up the transport. The teardown MUST be called on every exit
  //    path so we always release proxy ports (Cortex mode), held secrets,
  //    etc. — wrapped in try/finally below.
  const setup = await transport.setup();

  try {
    // 2. Build SDK options with cost-suppression defaults applied.
    const { options: sdkOpts } = pactToSdkOptions({
      pact,
      request,
      config,
      transportEnv: setup.env,
    });

    // 3. Run the SDK query. `query()` returns a `Query` (an
    //    `AsyncGenerator<SDKMessage>`). We iterate to drain the stream.
    const queryHandle = query({
      prompt: request.prompt,
      options: sdkOpts,
    });

    // 4. Drain the stream and assemble the AgentResult.
    return await drainSdkStream<T>(
      queryHandle as AsyncIterable<SDKMessage>,
      startTime,
    );
  } finally {
    // 5. Always release transport resources. Wrap in its own try so a
    //    teardown failure can't mask the original error.
    try {
      await setup.teardown();
    } catch {
      /* swallow — teardown failures are not actionable for the caller */
    }
  }
}

// ── Stream drain (testable separately) ───────────────────────────

/**
 * Consume an SDK message stream and synthesize a pacta `AgentResult`.
 *
 * Extracted from `invokeOneshot` so unit tests can exercise it with a
 * synthetic stream (no SDK subprocess spawn). The factory and tests
 * are the only callers.
 *
 * @param stream - The SDK's `Query` iterator (or any iterable of
 *   `SDKMessage` for testing).
 * @param startTime - `Date.now()` captured before the SDK call started,
 *   used to compute `durationMs` if the SDK doesn't surface its own.
 */
async function drainSdkStream<T>(
  stream: AsyncIterable<SDKMessage>,
  startTime: number,
): Promise<AgentResult<T>> {
  let resultSuccess: SDKResultSuccess | undefined;
  let resultError: { errors: string[]; subtype: string } | undefined;
  let sessionId = '';
  let turns = 0;
  let accumulatedUsage: TokenUsage = emptyUsage();

  for await (const msg of stream) {
    // Track session id from the first message that carries one.
    if (!sessionId) {
      const sid = (msg as { session_id?: string }).session_id;
      if (sid) sessionId = sid;
    }

    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        resultSuccess = msg;
        turns = msg.num_turns;
        accumulatedUsage = mapUsage(msg.usage);
      } else {
        resultError = {
          errors: (msg as { errors?: string[] }).errors ?? [],
          subtype: msg.subtype,
        };
      }
      // Continue draining — the SDK may emit a trailing
      // `prompt_suggestion` after the result. Exiting early would
      // leave the generator un-finalized.
    }
  }

  const durationMs = Date.now() - startTime;

  if (resultSuccess) {
    const cost = mapCost(resultSuccess, accumulatedUsage);
    return {
      output: resultSuccess.result as unknown as T,
      sessionId: resultSuccess.session_id || sessionId,
      completed: true,
      stopReason: stopReasonFromSdk(resultSuccess.stop_reason),
      usage: accumulatedUsage,
      cost,
      durationMs,
      turns,
    };
  }

  if (resultError) {
    return failedResult<T>({
      sessionId,
      durationMs,
      turns,
      usage: accumulatedUsage,
      message: resultError.errors.join('\n') || `SDK error: ${resultError.subtype}`,
      stopReason: 'error',
    });
  }

  // Stream ended without a result message — treat as truncated.
  return failedResult<T>({
    sessionId,
    durationMs,
    turns,
    usage: accumulatedUsage,
    message: 'SDK stream ended without a result message',
    stopReason: 'error',
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function failedResult<T>(input: {
  sessionId: string;
  durationMs: number;
  turns: number;
  usage: TokenUsage;
  message: string;
  stopReason: 'error' | 'budget_exhausted' | 'timeout' | 'killed';
}): AgentResult<T> {
  const cost: CostReport = {
    totalUsd: 0,
    perModel: {},
  };
  return {
    output: '' as unknown as T,
    sessionId: input.sessionId,
    completed: false,
    stopReason: input.stopReason,
    usage: input.usage,
    cost,
    durationMs: input.durationMs,
    turns: input.turns,
  };
}

/**
 * Translate the SDK's free-form `stop_reason` string into pacta's
 * fixed enum. The SDK uses Anthropic API stop reasons
 * (`end_turn`, `max_tokens`, `tool_use`, `stop_sequence`).
 */
function stopReasonFromSdk(stop: string | null): AgentResult['stopReason'] {
  if (stop === 'max_tokens') return 'budget_exhausted';
  return 'complete';
}
