// SPDX-License-Identifier: Apache-2.0
/**
 * `pactToSdkOptions` — pure function mapping a pacta `Pact` + `AgentRequest`
 * + provider config to the Claude Agent SDK's `Options` shape.
 *
 * This is the cost-defaults choke point. Spike 2 (`spike-2-overhead.md`)
 * showed that omitting any one of the suppression knobs balloons the
 * per-request body from ~5-8 KB to 100+ KB. The defaults here lock in
 * all four:
 *
 *   - `tools: []`            — disables built-in Claude Code tools (~80 KB)
 *   - `settingSources: []`   — explicit empty (NOT omitted; ~76 KB)
 *   - `agents: {}`           — no sub-agents (~? KB; defensive)
 *   - sanitized `env`        — drops cached MCP auth (~33 KB)
 *
 * The minimal `systemPrompt` override stops the SDK falling back to the
 * Claude Code preset (negligible bytes today, but defensive against
 * future SDK changes).
 *
 * Tenant overrides (per `Pact`):
 *   - `pact.scope.allowedTools` narrows the tools whitelist
 *   - `pact.scope.model` overrides the default model
 *   - `pact.budget.maxTurns` overrides the default turn cap
 */

import type { Pact, AgentRequest } from '@methodts/pacta';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { AnthropicSdkTransport } from './transport.js';

/**
 * Subset of `ClaudeAgentSdkProviderOptions` that the mapper actually
 * needs. Defined locally to avoid an `index.ts → factory.ts → mapper`
 * import cycle. The factory is responsible for synthesizing this from
 * its public options shape.
 */
export interface ClaudeAgentSdkProviderOptionsForMapper {
  defaultModel?: string;
  transport?: AnthropicSdkTransport;
  apiKey?: string;
  toolProvider?: unknown;
  maxTurns?: number;
}

/**
 * Default model when neither pact nor provider config specifies one.
 * Matches `pacta-provider-anthropic`'s default for cross-provider
 * consistency.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Default upper bound on agentic turns. Matches PRD §S2. */
const DEFAULT_MAX_TURNS = 25;

/**
 * Concise system prompt used when the request supplies none. The SDK's
 * own default has historically been a Claude Code preset; we override
 * with this minimal string so cost stays predictable.
 */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful agent.';

/**
 * Env vars the SDK subprocess legitimately needs to start (PATH, HOME,
 * tmp dirs, the Windows shell). Anything else from `process.env` is
 * dropped to prevent cached MCP auth / project settings leaking in
 * (see spike-2-overhead.md Run C).
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'SystemRoot',
  'COMSPEC',
] as const;

/**
 * Sanitize `process.env` to the SAFE_ENV_KEYS allowlist. Values are
 * coerced to `string`; missing keys are simply omitted.
 *
 * This MUST never include `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`,
 * `ANTHROPIC_API_KEY`, or any other state-sharing var — those come
 * from the transport's `setup()` env, not from the parent process.
 */
function sanitizedProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export interface PactToSdkOptionsInput {
  pact: Pact;
  request: AgentRequest;
  config: ClaudeAgentSdkProviderOptionsForMapper;
  /** Env vars contributed by the transport's `setup()` call. */
  transportEnv: Record<string, string>;
}

/**
 * Build the SDK `Options` object for one invocation.
 *
 * Pure function — no side effects, no I/O. All inputs come in via the
 * `input` parameter; output is the SDK options object plus the model
 * string we resolved (callers may want it for usage attribution).
 */
export function pactToSdkOptions(input: PactToSdkOptionsInput): {
  options: Options;
  model: string;
} {
  const { pact, request, config, transportEnv } = input;

  // ── Cost-suppression defaults (G-COST) ──────────────────────────
  // Each of these defends against one of the cost vectors documented
  // in spike-2-overhead.md. Removing any one is a regression — the
  // architecture test asserts they're all set.

  let tools: string[] = [];
  if (pact.scope?.allowedTools && pact.scope.allowedTools.length > 0) {
    // Tenant explicitly opts in to a narrowed tool list. We pass it
    // through verbatim — the SDK will filter to those names. Empty
    // arrays still mean "no tools", matching the default.
    tools = [...pact.scope.allowedTools];
  }

  // ── Resolve runtime knobs ────────────────────────────────────────

  const model = pact.scope?.model ?? config.defaultModel ?? DEFAULT_MODEL;
  const maxTurns = pact.budget?.maxTurns ?? config.maxTurns ?? DEFAULT_MAX_TURNS;
  const systemPrompt = request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  // ── Build env (sanitized parent + transport overrides) ──────────
  // Transport env wins; this lets the Cortex transport set
  // ANTHROPIC_BASE_URL to its proxy without us having to special-case
  // the var here.
  const env: Record<string, string> = {
    ...sanitizedProcessEnv(),
    ...transportEnv,
  };

  // ── Assemble Options ────────────────────────────────────────────
  // We use `as Options` cast at the end because the SDK's Options has
  // a number of fields we don't touch (sandbox, hooks, plugins, etc.)
  // and TypeScript is happy with the partial we build.

  const options: Options = {
    // G-COST defenses — see file header
    tools,
    settingSources: [],
    agents: {},
    env,

    // Tenant-controlled
    model,
    maxTurns,
    systemPrompt,

    // Disable session persistence; pacta owns session identity at the
    // outer layer. Avoids littering ~/.claude/projects with one entry
    // per invocation.
    persistSession: false,

    // Wire the abort signal through if the request supplies one. The
    // SDK uses this to terminate the spawned CLI cleanly.
    ...(request.abortSignal
      ? { abortController: abortSignalToController(request.abortSignal) }
      : {}),
  };

  return { options, model };
}

/**
 * The SDK's `Options.abortController` expects an `AbortController`, but
 * pacta hands us an `AbortSignal`. Wrap it in a controller that aborts
 * when the source signal does.
 *
 * If the source signal is already aborted, the new controller starts
 * already-aborted — the SDK handles this by exiting before any work.
 */
function abortSignalToController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
    return controller;
  }
  signal.addEventListener(
    'abort',
    () => controller.abort(signal.reason),
    { once: true },
  );
  return controller;
}
