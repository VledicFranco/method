// SPDX-License-Identifier: Apache-2.0
/**
 * Streaming implementation for `claudeAgentSdkProvider` (Wave 2 / C-3).
 *
 * Implements `Streamable.stream()` from `@methodts/pacta`'s
 * `AgentProvider` port. Wraps `@anthropic-ai/claude-agent-sdk`'s
 * `query()` (which returns an `AsyncGenerator<SDKMessage>`) and yields
 * pacta `AgentEvent`s as the SDK turns the inner agent loop.
 *
 * Design notes
 * ─────────────
 *
 * - **Standalone module.** `streamSdkInvocation` does not import from
 *   `factory.ts` or `event-mapper.ts` (both C-1 deliverables). Instead
 *   it accepts the prepared SDK `Options`, an `eventMapper` callback,
 *   and an injectable `query` function. C-1's factory wires it in via
 *   one hook line — the orchestrator handles the merge.
 *
 * - **Topological ordering** (PRD AC-3.1). The SDK already emits
 *   messages in causal order: `system init` → assistant text/tool_use
 *   → tool_result (synthetic `user` message with `tool_use_result`) →
 *   final `result`. We map each SDK message to zero-or-more pacta
 *   `AgentEvent`s and yield each in order, never reordering.
 *
 * - **Cancellation** (PRD AC-3.3). The SDK exposes
 *   `Options.abortController` and `Query.close()` as cancellation
 *   seams. We honor `pact.scope?.abortController` and
 *   `request.abortSignal` — whichever the caller provides — by:
 *     1. Forwarding the signal to a fresh `AbortController` we wire
 *        into `Options.abortController` (the SDK owns the controller
 *        lifecycle).
 *     2. Calling `Query.close()` in a `finally` block so iterator
 *        teardown (early `return()`, exception, signal abort) always
 *        terminates the spawned CLI subprocess.
 *
 * - **Sub-agent events** (PRD AC-3.2 / S1 §10 non-goal). The SDK emits
 *   sub-agent activity as either nested assistant messages (with
 *   `parent_tool_use_id` set) or `task_*` system messages. We surface
 *   them as opaque `tool_use` events with `tool: 'sub-agent'` and the
 *   parent tool-use id preserved, so consumers don't crash on unknown
 *   shapes. Full sub-agent observability is a future iteration.
 */

import type {
  AgentEvent,
  AgentRequest,
  Pact,
} from '@methodts/pacta';

// ── Minimal structural types over the SDK ─────────────────────────
//
// We deliberately do NOT import from `@anthropic-ai/claude-agent-sdk`
// at this layer; it is a peer dep and the architecture gates forbid
// upward-only imports. The factory layer (C-1) is the one place that
// touches the SDK directly. Here we describe just the shape we need.

/**
 * The minimal subset of the SDK's `Options` that streaming needs to
 * thread through. The real `Options` type is much wider — C-1's
 * `pact-to-sdk-options.ts` builds the full object; we only need the
 * parts that affect cancellation.
 */
export interface StreamSdkOptions {
  /** Cancellation controller; will be created here if not provided. */
  abortController?: AbortController;
  /** All other SDK Options pass through opaquely. */
  [key: string]: unknown;
}

/**
 * The SDK's `Query` shape — an `AsyncGenerator<SDKMessage>` with a
 * `close()` method for forced teardown of the spawned CLI subprocess.
 */
export interface SdkQueryHandle<TMessage> extends AsyncIterable<TMessage> {
  close(): void;
}

/**
 * Dependency-injected SDK entrypoint. In production this is bound to
 * `query` from `@anthropic-ai/claude-agent-sdk`; in tests we pass a
 * mock that yields a scripted message stream.
 */
export type SdkQueryFn<TMessage> = (params: {
  prompt: string;
  options?: StreamSdkOptions;
}) => SdkQueryHandle<TMessage>;

/**
 * Maps one SDK message to zero-or-more pacta `AgentEvent`s. The C-1
 * commission ships the real implementation in `event-mapper.ts`; the
 * stream module is mapper-agnostic so the two land independently.
 */
export type SdkMessageMapper<TMessage> = (msg: TMessage) => AgentEvent[];

// ── Public entrypoint ─────────────────────────────────────────────

/**
 * Stream `AgentEvent`s from a single SDK invocation.
 *
 * Topological order is preserved: events are yielded in the same order
 * the SDK emits them, with at-most-one expansion per source message.
 *
 * Cancellation is observed via `pact.scope?.abortController?.signal`
 * and `request.abortSignal`. Whichever fires first aborts the SDK
 * controller and triggers `Query.close()`.
 *
 * @param pact      The pact being executed (read-only here).
 * @param request   Caller-supplied request (used for prompt + abort).
 * @param sdkOptions Pre-built SDK Options (from C-1's
 *                  `pact-to-sdk-options.ts`). Streaming may attach a
 *                  fresh `abortController` if none was supplied.
 * @param mapper    SDK message → AgentEvent[] mapper (from C-1's
 *                  `event-mapper.ts` once it lands).
 * @param queryFn   The SDK `query` function. Injected so unit tests
 *                  can drive a deterministic message stream.
 */
export async function* streamSdkInvocation<TMessage>(
  pact: Pact,
  request: AgentRequest,
  sdkOptions: StreamSdkOptions,
  mapper: SdkMessageMapper<TMessage>,
  queryFn: SdkQueryFn<TMessage>,
): AsyncIterable<AgentEvent> {
  // ── Wire up cancellation ────────────────────────────────────────
  //
  // Three signals can arrive: `pact.scope?.abortController?.signal`,
  // `request.abortSignal`, or external abort of `sdkOptions.abortController`.
  // We unify them onto the SDK's controller so the spawned CLI dies
  // cleanly when any source aborts.
  const sdkController = sdkOptions.abortController ?? new AbortController();
  const optionsForSdk: StreamSdkOptions = {
    ...sdkOptions,
    abortController: sdkController,
  };

  const externalSignals: AbortSignal[] = [];
  if (request.abortSignal) externalSignals.push(request.abortSignal);
  const scopeSignal = (pact.scope as { abortController?: AbortController } | undefined)
    ?.abortController?.signal;
  if (scopeSignal) externalSignals.push(scopeSignal);

  const onExternalAbort = (): void => {
    if (!sdkController.signal.aborted) {
      try {
        sdkController.abort();
      } catch {
        /* noop — best-effort cancellation */
      }
    }
  };

  for (const sig of externalSignals) {
    if (sig.aborted) {
      onExternalAbort();
    } else {
      sig.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let handle: SdkQueryHandle<TMessage> | undefined;
  try {
    handle = queryFn({ prompt: request.prompt, options: optionsForSdk });

    for await (const msg of handle) {
      // Map → yield. A single SDK message may expand to 0..N events.
      const events = mapper(msg);
      for (const ev of events) {
        yield ev;
      }
    }
  } catch (err) {
    // Surface SDK errors as a final pacta `error` event before
    // re-throwing. Consumers that prefer iteration-completes-cleanly
    // semantics get one well-typed event; consumers that prefer
    // exception flow still get the throw.
    const message = err instanceof Error ? err.message : String(err);
    yield {
      type: 'error',
      message,
      recoverable: false,
    };
    throw err;
  } finally {
    // Always tear down the SDK subprocess. Safe to call multiple
    // times; safe to call after natural completion.
    try {
      handle?.close();
    } catch {
      /* noop — close is best-effort */
    }
    // Detach external listeners — they hold a reference back to us.
    for (const sig of externalSignals) {
      sig.removeEventListener('abort', onExternalAbort);
    }
  }
}
