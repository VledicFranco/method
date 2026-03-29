/**
 * Provider Adapter — bridges AgentProvider.invoke() to the cognitive module step() contract.
 *
 * Cognitive modules that need LLM invocation (Reasoner, Planner) use the ProviderAdapter
 * instead of calling AgentProvider directly. The adapter:
 * 1. Builds a Pact from pactTemplate (defaulting mode to oneshot)
 * 2. Constructs an AgentRequest from workspace snapshot contents
 * 3. Calls provider.invoke()
 * 4. Maps AgentResult to ProviderAdapterResult
 * 5. Propagates errors as StepError-compatible format
 */

import type { Pact, AgentRequest, TokenUsage, CostReport } from '../../pact.js';
import type { AgentProvider } from '../../ports/agent-provider.js';
import type { ReadonlyWorkspaceSnapshot } from './workspace-types.js';
import type { StepError } from './module.js';

// ── Adapter Config ───────────────────────────────────────────────

/** Configuration for a provider adapter invocation. */
export interface AdapterConfig {
  /** Base pact fields for LLM invocations. Mode defaults to oneshot if not specified. */
  pactTemplate: Partial<Pact>;

  /** Optional system prompt appended to the agent context. */
  systemPrompt?: string;

  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;

  /** Timeout in milliseconds for the provider invocation. Default: 30000 (30s). */
  timeoutMs?: number;
}

// ── Adapter Result ───────────────────────────────────────────────

/** Result of a provider adapter invocation. */
export interface ProviderAdapterResult {
  /** The LLM's text output. */
  output: string;

  /** Token usage for this invocation. */
  usage: TokenUsage;

  /** Cost report for this invocation. */
  cost: CostReport;
}

// ── Provider Adapter Interface ───────────────────────────────────

/** Port interface for cognitive modules that need LLM invocation. */
export interface ProviderAdapter {
  invoke(
    workspaceSnapshot: ReadonlyWorkspaceSnapshot,
    config: AdapterConfig,
  ): Promise<ProviderAdapterResult>;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a ProviderAdapter from an existing AgentProvider.
 *
 * The adapter builds an AgentRequest by concatenating workspace entry contents
 * as prompt context, invokes the provider, and maps the result.
 */
export function createProviderAdapter(
  provider: AgentProvider,
  defaults: AdapterConfig,
): ProviderAdapter {
  return {
    async invoke(
      workspaceSnapshot: ReadonlyWorkspaceSnapshot,
      config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      const timeoutMs = config.timeoutMs ?? defaults.timeoutMs ?? 30_000;

      // Create a combined abort signal: user signal + timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new Error(`Provider invocation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );

      // If caller provided an abort signal, chain it
      if (config.abortSignal) {
        config.abortSignal.addEventListener(
          'abort',
          () => controller.abort(config.abortSignal!.reason),
          { once: true },
        );
      }
      if (defaults.abortSignal) {
        defaults.abortSignal.addEventListener(
          'abort',
          () => controller.abort(defaults.abortSignal!.reason),
          { once: true },
        );
      }

      try {
        // Build pact: merge defaults with per-call config, default mode to oneshot
        const pact: Pact = {
          mode: defaults.pactTemplate.mode ?? { type: 'oneshot' },
          ...defaults.pactTemplate,
          ...config.pactTemplate,
        };

        // Ensure mode is always present (Pact requires it)
        if (!pact.mode) {
          pact.mode = { type: 'oneshot' };
        }

        // Build prompt from workspace snapshot contents
        const promptParts: string[] = [];
        for (const entry of workspaceSnapshot) {
          const content = typeof entry.content === 'string'
            ? entry.content
            : JSON.stringify(entry.content);
          promptParts.push(content);
        }
        const prompt = promptParts.join('\n\n');

        // Build agent request — use the combined signal
        const request: AgentRequest = {
          prompt,
          systemPrompt: config.systemPrompt ?? defaults.systemPrompt,
          abortSignal: controller.signal,
        };

        // Invoke provider
        const result = await provider.invoke(pact, request);

        return {
          output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
          usage: result.usage,
          cost: result.cost,
        };
      } catch (err: unknown) {
        // Check if this was a timeout
        const isTimeout = controller.signal.aborted
          && err instanceof Error
          && err.message.includes('timed out');
        const message = err instanceof Error ? err.message : String(err);

        // Propagate as StepError-compatible format
        const stepError: StepError = {
          message: isTimeout ? `Provider timeout after ${timeoutMs}ms` : message,
          recoverable: !isTimeout,  // Timeouts are not recoverable
          moduleId: 'provider-adapter' as import('./module.js').ModuleId,
          phase: 'invoke',
        };
        throw Object.assign(
          new Error(stepError.message),
          { stepError },
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
