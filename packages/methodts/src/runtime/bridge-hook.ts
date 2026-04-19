// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge channel hook — forwards RuntimeEvents to bridge visibility channels.
 *
 * Pure formatters map RuntimeEvent variants to the bridge's two channel formats:
 * - Progress channel: { step, status, detail?, timestamp }
 * - Event channel: { type, payload, timestamp }
 *
 * The hook itself is fire-and-forget (non-blocking). Actual HTTP POST
 * to bridge endpoints is deferred to Phase 2 — this module provides the
 * formatting layer and hook constructor.
 *
 * @see CLAUDE.md — Bridge Channel API
 * @see PRD 021 §12.5 — EventHook
 */

import { Effect } from "effect";
import type { EventHook } from "./hooks.js";
import type { EventFilter } from "./event-bus.js";
import type { RuntimeEvent } from "./events.js";

// ── Configuration ──

/** Configuration for the bridge channel hook. */
export type BridgeHookConfig<S = unknown> = {
  readonly bridgeUrl: string;
  readonly sessionId: string;
  readonly filter?: EventFilter<S>;
};

// ── Progress formatter ──

/** Progress channel payload shape (matches POST /sessions/:id/channels/progress). */
export type ProgressPayload = {
  readonly step: string;
  readonly status: string;
  readonly detail?: string;
  readonly timestamp: string;
};

/**
 * Format a RuntimeEvent into a bridge progress channel payload.
 * Maps methodology events to step/status/detail format.
 */
export function formatProgress<S>(event: RuntimeEvent<S>): ProgressPayload {
  const timestamp = event.timestamp.toISOString();

  switch (event.type) {
    case "step_started":
      return { step: event.stepId, status: "started", detail: `Execution: ${event.executionTag}`, timestamp };
    case "step_completed":
      return { step: event.stepId, status: "completed", detail: `Cost: $${event.cost.usd.toFixed(4)}`, timestamp };
    case "step_retried":
      return { step: event.stepId, status: "retrying", detail: `Attempt ${event.attempt}: ${event.feedback}`, timestamp };
    case "method_selected":
      return { step: event.methodId, status: "method_selected", detail: `Arm: ${event.arm}`, timestamp };
    case "method_completed":
      return { step: event.methodId, status: event.objectiveMet ? "objective_met" : "objective_not_met", timestamp };
    case "methodology_started":
      return { step: event.methodologyId, status: "started", timestamp };
    case "methodology_completed":
      return { step: "methodology", status: event.status, timestamp };
    case "gate_evaluated":
      return { step: event.gateId, status: event.passed ? "gate_passed" : "gate_failed", timestamp };
    case "safety_warning":
      return { step: "safety", status: "warning", detail: `${event.bound}: ${event.usage}/${event.limit}`, timestamp };
    default:
      return { step: event.type, status: "event", timestamp };
  }
}

// ── Event formatter ──

/** Event channel payload shape (matches POST /sessions/:id/channels/events). */
export type EventPayload = {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
};

/**
 * Format a RuntimeEvent into a bridge event channel payload.
 */
export function formatEvent<S>(event: RuntimeEvent<S>): EventPayload {
  return {
    type: event.type,
    payload: { ...event } as Record<string, unknown>,
    timestamp: event.timestamp.toISOString(),
  };
}

// ── Hook constructor ──

/**
 * Create an EventHook that forwards RuntimeEvents to bridge channels.
 * Uses fire-and-forget mode (non-blocking).
 *
 * Phase 1: pure formatters are tested; handler invokes formatters but
 * does not issue HTTP calls.
 * Phase 2: handler will POST to bridge progress + event endpoints.
 */
export function bridgeChannelHook<S>(config: BridgeHookConfig<S>): EventHook<S> {
  return {
    id: `bridge-channel-${config.sessionId}`,
    description: `Forward events to bridge session ${config.sessionId}`,
    filter: config.filter,
    handler: (event) =>
      Effect.sync(() => {
        // Phase 2: actual HTTP POST to bridge
        // formatProgress(event) → POST {bridgeUrl}/sessions/{sessionId}/channels/progress
        // formatEvent(event) → POST {bridgeUrl}/sessions/{sessionId}/channels/events
        const _progress = formatProgress(event);
        const _eventPayload = formatEvent(event);
      }),
    mode: "fire_and_forget",
  };
}
