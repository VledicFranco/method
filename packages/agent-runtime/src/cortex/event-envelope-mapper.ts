// SPDX-License-Identifier: Apache-2.0
/**
 * event-envelope-mapper — pure RuntimeEvent → Cortex envelope projection.
 *
 * PRD-063 §Scope item 3. S6 §3.1-3.3.
 *
 * Responsibilities:
 *   - Look up `runtimeEvent.type` in `METHOD_TOPIC_REGISTRY`. If absent,
 *     return null (audit-only) or throw if the type is explicitly unknown
 *     (`G-CONNECTOR-TOPIC-ALLOWLIST`).
 *   - Build the `{ topic, envelope }` pair the connector hands to
 *     `ctx.events.emit(topic, payload)`.
 *   - Apply O8 truncation — `artifact_markdown` > `truncationThresholdBytes`
 *     is truncated to a `artifact_preview_markdown` + `artifact_ref`.
 *   - Preserve `runtimeEvent.timestamp` (do not resample).
 *   - Derive the deterministic Cortex `eventId` from `runtimeEvent.id` so
 *     Cortex can dedupe on retries.
 *
 * Pure — no I/O, no side effects. Testable in isolation.
 */

import type { RuntimeEvent } from '@methodts/runtime/ports';

import type { MethodTopicDescriptor } from './ctx-types.js';
import { RUNTIME_EVENT_TYPE_TO_TOPIC } from './event-topic-registry.js';

// ── Public types ─────────────────────────────────────────────────

export interface CortexEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly emitterAppId: string;
  readonly emittedAt: string;
  readonly emittedBy: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schemaVersion: number;
}

export interface EnvelopeMapResult {
  readonly topic: string;
  readonly envelope: CortexEnvelope;
  readonly descriptor: MethodTopicDescriptor;
}

export interface EnvelopeMapperConfig {
  readonly appId: string;
  /** Override the `emittedBy` principal (defaults to `service:<appId>`). */
  readonly emittedBy?: string;
  /**
   * O8 truncation threshold in bytes (default 32 KB). Applies to
   * `artifact_markdown`, `prompt`, and `output` fields when they exceed
   * this size. Chosen well below the PRD-072 256 KB SNS ceiling.
   */
  readonly truncationThresholdBytes?: number;
  /**
   * Optional opaque artifact reference prefix. When a field is truncated,
   * the mapper attaches `artifact_ref = `${prefix}${eventId}`` for
   * dashboards to dereference. Defaults to `'runtime-event://'`.
   */
  readonly artifactRefPrefix?: string;
}

/**
 * Audit-only outcome. Returned when the RuntimeEvent is known but not
 * projected to any events topic (e.g., `session.observation`,
 * `agent.text`).
 */
export interface AuditOnlyResult {
  readonly kind: 'audit-only';
}

/**
 * The RuntimeEvent has no registry entry AND is not in the explicit
 * audit-only allowlist. This signals **drift** — new runtime event type
 * shipped without taxonomy update. Surfaces in `gates.test.ts`.
 */
export interface UnknownResult {
  readonly kind: 'unknown';
  readonly type: string;
}

export type MapOutcome =
  | { readonly kind: 'envelope'; readonly result: EnvelopeMapResult }
  | AuditOnlyResult
  | UnknownResult;

// ── Audit-only types (18 known, per S6 §3.3) ────────────────────
//
// These RuntimeEvent types are intentionally not projected to ctx.events.
// They are captured on the audit path only (high-frequency or internal).
// The set is closed by the PRD; new types that aren't in the registry and
// aren't in this set are classified as `unknown` (drift).
export const METHOD_AUDIT_ONLY_RUNTIME_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.state_changed',
  'session.observation',
  'session.observation.idle',
  'trigger.disabled',
  'trigger.enabled',
  'project.discovered',
  'project.updated',
  'agent.started',
  'agent.text',
  'agent.thinking',
  'agent.tool_result',
  'cost.observation_recorded',
  'cost.estimate_emitted',
  'cost.slot_leaked',
  'system.bus_stats',
  'system.bus_error',
  'system.sink_overflow',
  // Cognitive / miscellaneous internal
  'agent.turn_complete',
  'agent.context_compacted',
  'agent.reflection',
  'agent.token_exchange',
]);

const DEFAULT_TRUNCATION_BYTES = 32 * 1024;
const DEFAULT_ARTIFACT_REF_PREFIX = 'runtime-event://';

// ── Core API ─────────────────────────────────────────────────────

/**
 * Map a RuntimeEvent into a Cortex envelope ready for `ctx.events.emit`.
 *
 * Returns:
 *   - `{ kind: 'envelope', result }` — the event has a registry entry.
 *   - `{ kind: 'audit-only' }` — the type is explicitly audit-only.
 *   - `{ kind: 'unknown', type }` — the type has no registry entry and is
 *     not in the audit-only allowlist. Connector emits a throttled
 *     `connector.topic_undeclared` and drops.
 */
export function mapRuntimeEventToEnvelope(
  event: RuntimeEvent,
  config: EnvelopeMapperConfig,
): MapOutcome {
  const descriptor = RUNTIME_EVENT_TYPE_TO_TOPIC.get(event.type);
  if (descriptor) {
    return {
      kind: 'envelope',
      result: buildEnvelope(event, descriptor, config),
    };
  }
  if (METHOD_AUDIT_ONLY_RUNTIME_EVENT_TYPES.has(event.type)) {
    return { kind: 'audit-only' };
  }
  return { kind: 'unknown', type: event.type };
}

/**
 * Throwing variant — used by `G-CONNECTOR-TOPIC-ALLOWLIST` gate and by
 * tests that assert drift is a hard error.
 */
export function mapRuntimeEventOrThrow(
  event: RuntimeEvent,
  config: EnvelopeMapperConfig,
): EnvelopeMapResult {
  const outcome = mapRuntimeEventToEnvelope(event, config);
  if (outcome.kind === 'envelope') return outcome.result;
  if (outcome.kind === 'audit-only') {
    throw new Error(
      `mapRuntimeEventOrThrow: event type '${event.type}' is audit-only and has no topic descriptor`,
    );
  }
  throw new Error(
    `mapRuntimeEventOrThrow: no topic descriptor for RuntimeEvent type '${event.type}'`,
  );
}

// ── Internals ────────────────────────────────────────────────────

function buildEnvelope(
  event: RuntimeEvent,
  descriptor: MethodTopicDescriptor,
  config: EnvelopeMapperConfig,
): EnvelopeMapResult {
  const threshold = config.truncationThresholdBytes ?? DEFAULT_TRUNCATION_BYTES;
  const artifactRefPrefix = config.artifactRefPrefix ?? DEFAULT_ARTIFACT_REF_PREFIX;

  // S6 §3.3: session.killed vs session.dead both map to method.session.ended
  // with a `reason` discriminator. strategy.gate_passed vs gate_failed both
  // map to method.strategy.gate with a `result` discriminator.
  const payload = projectPayload(event, descriptor, threshold, artifactRefPrefix);

  const envelope: CortexEnvelope = {
    // Derive deterministic ULID-like id from the RuntimeEvent UUID so
    // Cortex can dedupe on retries (S6 §3.1).
    eventId: deriveEventId(event.id),
    eventType: descriptor.topic,
    emitterAppId: config.appId,
    emittedAt: event.timestamp,
    emittedBy: config.emittedBy ?? `service:${config.appId}`,
    payload,
    schemaVersion: descriptor.schemaVersion,
  };

  return { topic: descriptor.topic, envelope, descriptor };
}

/**
 * Produce the Cortex payload from a RuntimeEvent, applying discriminator
 * injection and truncation. Adds `sessionId`, `projectId`, `correlationId`
 * when present on the RuntimeEvent so subscribers can correlate.
 */
function projectPayload(
  event: RuntimeEvent,
  descriptor: MethodTopicDescriptor,
  truncationBytes: number,
  artifactRefPrefix: string,
): Readonly<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    runtimeEventId: event.id,
    runtimeEventType: event.type,
    domain: event.domain,
    severity: event.severity,
    ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
    ...(event.projectId !== undefined ? { projectId: event.projectId } : {}),
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    ...event.payload,
  };

  // Discriminator injection per S6 §3.3.
  if (descriptor.topic === 'method.session.ended') {
    if (event.type === 'session.dead' && base.reason === undefined) {
      base.reason = 'crashed';
    } else if (event.type === 'session.killed' && base.reason === undefined) {
      base.reason = 'killed';
    }
  }
  if (descriptor.topic === 'method.strategy.gate') {
    if (event.type === 'strategy.gate_passed' && base.result === undefined) {
      base.result = 'passed';
    } else if (event.type === 'strategy.gate_failed' && base.result === undefined) {
      base.result = 'failed';
    }
  }

  // O8 truncation — artifact_markdown (primary risk), prompt, output.
  const TRUNCATION_FIELDS: readonly string[] = ['artifact_markdown', 'prompt', 'output'];
  for (const field of TRUNCATION_FIELDS) {
    const value = base[field];
    if (typeof value !== 'string') continue;
    // Byte size via UTF-8 encode — getByteLength is cheap for strings
    // under a few MB (which is our ceiling anyway).
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength <= truncationBytes) continue;
    base[field] = truncateUtf8(value, truncationBytes);
    base[`${field}_truncated`] = true;
    base[`${field}_original_bytes`] = byteLength;
    // Preview keyed by field (dashboards show which field was truncated).
    base[`${field}_preview`] = base[field];
    base.artifact_ref = `${artifactRefPrefix}${event.id}/${field}`;
  }

  return base;
}

/**
 * Truncate a UTF-8 string to at most `maxBytes` bytes. Safe at codepoint
 * boundaries — never emits a split multi-byte sequence.
 */
function truncateUtf8(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, 'utf8');
  if (buf.byteLength <= maxBytes) return str;
  // Trim to a codepoint boundary by decoding and retrying with a smaller
  // cut until the decoded length stabilises. Cheap — at most 4 iterations.
  let cut = maxBytes;
  for (let i = 0; i < 4; i++) {
    const candidate = buf.subarray(0, cut).toString('utf8');
    // If re-encoding stays ≤ maxBytes, accept.
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      return candidate;
    }
    cut -= 1;
  }
  // Fallback: conservatively slice.
  return buf.subarray(0, maxBytes - 4).toString('utf8');
}

/**
 * Deterministically derive an envelope id from the RuntimeEvent UUID.
 * Cortex uses it only for idempotency on retries — stability matters more
 * than ULID format. We prefix so events originating from method never
 * collide with natively-emitted Cortex events.
 */
function deriveEventId(runtimeEventId: string): string {
  return `mre-${runtimeEventId}`;
}
