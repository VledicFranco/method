// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge-side SessionProviderFactory (PRD-057 / S2 §6 / C5).
 *
 * Produces concrete `PtySession` values backed by bridge's local providers:
 *
 *   - `mode === 'print'`        → `createPrintSession` from `@methodts/runtime/sessions`
 *                                 wired to `claudeCliProvider` (claude CLI binary).
 *   - `mode === 'cognitive-agent'` → `createCognitiveSession` from
 *                                    `@methodts/runtime/sessions` wired to
 *                                    `anthropicProvider` or `ollamaProvider`
 *                                    (dynamic-imported to avoid eager load).
 *
 * The factory is injected into `createPool({ providerFactory })` — pool
 * keeps worktree isolation, chain bookkeeping, diagnostics, and channels.
 *
 * This module is intentionally *thin*: current `server-entry.ts` still
 * calls `createPool()` without a factory (the built-in fallback paths in
 * runtime/sessions/pool.ts reproduce today's behavior bit-identically).
 * C7 will flip the composition root to supply `providerFactory` here,
 * after a round of integration validation.
 */

import type {
  SessionProviderFactory,
  SessionProviderOptions,
  PtySessionHandle,
} from '@methodts/runtime/ports';
import type {
  PtySession,
  StreamEvent,
  CognitiveEventContext,
} from '@methodts/runtime/sessions';
import {
  createPrintSession,
  createCognitiveSession,
  createRuntimeToolProvider,
  CognitiveEventBusSink,
} from '@methodts/runtime/sessions';
import type { EventBus } from '@methodts/runtime/ports';
import type { AgentProvider, TraceSink } from '@methodts/pacta';

export interface CreateBridgeSessionProviderFactoryOptions {
  /**
   * Event bus used when emitting per-session cognitive events. When
   * absent, the factory emits no bus events (tests / fixtures can
   * opt-out).
   */
  eventBus?: EventBus;
  /**
   * Default LLM provider for cognitive-agent sessions when the pool
   * caller does not pin one via `cognitiveConfig.llm_provider`.
   */
  defaultCognitiveProvider?: 'anthropic' | 'ollama';
}

export function createBridgeSessionProviderFactory(
  options: CreateBridgeSessionProviderFactoryOptions = {},
): SessionProviderFactory {
  const { eventBus, defaultCognitiveProvider = 'anthropic' } = options;

  return {
    async createSession(opts: SessionProviderOptions): Promise<PtySessionHandle> {
      const { sessionId, mode, workdir, metadata, onEvent, cognitiveConfig, cognitiveSink, traceSinks } = opts;

      if (mode === 'cognitive-agent') {
        const { createProviderAdapter } = await import('@methodts/pacta');
        const tools = createRuntimeToolProvider(workdir);

        const cfgRecord = (cognitiveConfig ?? {}) as Record<string, unknown>;
        const llmProviderName = typeof cfgRecord.llm_provider === 'string'
          ? (cfgRecord.llm_provider as 'anthropic' | 'ollama')
          : defaultCognitiveProvider;
        const model = typeof cfgRecord.model === 'string'
          ? cfgRecord.model
          : (typeof metadata?.model === 'string' ? metadata.model : undefined);
        const baseUrl = typeof cfgRecord.baseUrl === 'string' ? cfgRecord.baseUrl : undefined;

        const agentProvider = await resolveProvider(llmProviderName, { model, baseUrl, toolProvider: tools });
        const adapter = createProviderAdapter(agentProvider, {
          pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 4096 } },
        });

        const session = createCognitiveSession({
          id: sessionId,
          workdir,
          adapter,
          tools,
          cognitiveSink: cognitiveSink as CognitiveEventBusSink | undefined,
          // PRD 058 Wave 3: forward per-session TraceSinks (TraceEventBusSink and
          // optional ring buffers) into the cognitive session. Cast back from
          // the port-level `unknown[]` boundary to the concrete pacta TraceSink
          // shape — the composition root is the only producer.
          traceSinks: traceSinks as TraceSink[] | undefined,
          config: pickCognitiveConfig(cfgRecord),
          initialPrompt: typeof cfgRecord.initialPrompt === 'string' ? cfgRecord.initialPrompt : undefined,
          onEvent: (event: StreamEvent) => {
            onEvent(event);
            if (eventBus) {
              eventBus.emit({
                version: 1,
                domain: 'session',
                type: `session.cognitive.${event.type}`,
                severity: 'info',
                sessionId,
                payload: event as unknown as Record<string, unknown>,
                source: 'bridge/sessions/factory',
              });
            }
          },
        });
        return session as PtySession;
      }

      // print mode
      const { claudeCliProvider } = await import('@methodts/pacta-provider-claude-cli');
      const effectiveModel = typeof metadata?.model === 'string' ? metadata.model : undefined;
      const providerOverride: AgentProvider = claudeCliProvider({ model: effectiveModel });
      const session = createPrintSession({
        id: sessionId,
        workdir,
        providerOverride,
        model: effectiveModel,
      });
      void cognitiveSink; // print-mode does not currently consume the cognitive sink.
      void traceSinks; // print-mode emits no hierarchical trace events (PRD 058 Wave 3).
      return session as PtySession;
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────

async function resolveProvider(
  providerName: 'anthropic' | 'ollama',
  config: { model?: string; baseUrl?: string; toolProvider?: ReturnType<typeof createRuntimeToolProvider> },
): Promise<AgentProvider> {
  switch (providerName) {
    case 'anthropic': {
      const { anthropicProvider } = await import('@methodts/pacta-provider-anthropic');
      return anthropicProvider({ model: config.model, toolProvider: config.toolProvider });
    }
    case 'ollama': {
      const { ollamaProvider } = await import('@methodts/pacta-provider-ollama');
      const provider = ollamaProvider({
        baseUrl: config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://chobits:11434',
        model: config.model,
      });
      await provider.init();
      return provider;
    }
  }
}

function pickCognitiveConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    'name',
    'patterns',
    'maxCycles',
    'workspaceCapacity',
    'confidenceThreshold',
    'stagnationThreshold',
    'interventionBudget',
  ]) {
    if (cfg[key] !== undefined) out[key] = cfg[key];
  }
  return out;
}

// Avoid unused-import lint noise when CognitiveEventContext comes in as a type.
void null as unknown as CognitiveEventContext;
