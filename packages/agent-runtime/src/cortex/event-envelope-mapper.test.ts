// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for event-envelope-mapper — PRD-063 §Tests (unit).
 *
 * Maps success criteria:
 *   S1 — every mapped type produces a valid envelope
 *   S2 — audit-only types return null (kind: 'audit-only')
 *   N4 (O8) — artifact_markdown > 32KB truncated with artifact_ref
 *   G-CONNECTOR-TOPIC-ALLOWLIST — mapRuntimeEventOrThrow throws on unknown
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeEvent } from '@methodts/runtime/ports';

import {
  mapRuntimeEventToEnvelope,
  mapRuntimeEventOrThrow,
  METHOD_AUDIT_ONLY_RUNTIME_EVENT_TYPES,
  type EnvelopeMapperConfig,
} from './event-envelope-mapper.js';
import { METHOD_TOPIC_REGISTRY } from './event-topic-registry.js';

function ev(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  return {
    id: `evt-${type}-${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    timestamp: '2026-04-15T10:00:00.000Z',
    sequence: 1,
    domain: 'session',
    type,
    severity: 'info',
    payload,
    source: 'test',
  };
}

const mapperConfig: EnvelopeMapperConfig = {
  appId: 'method-runtime-test',
  truncationThresholdBytes: 32 * 1024,
};

describe('mapRuntimeEventToEnvelope — S1 (round-trip mapping)', () => {
  for (const desc of METHOD_TOPIC_REGISTRY) {
    for (const sourceType of desc.sourceEventTypes) {
      it(`${sourceType} → ${desc.topic}`, () => {
        const outcome = mapRuntimeEventToEnvelope(ev(sourceType), mapperConfig);
        assert.equal(outcome.kind, 'envelope');
        if (outcome.kind === 'envelope') {
          assert.equal(outcome.result.topic, desc.topic);
          assert.equal(outcome.result.envelope.eventType, desc.topic);
          assert.equal(outcome.result.envelope.schemaVersion, desc.schemaVersion);
          assert.equal(outcome.result.envelope.emitterAppId, 'method-runtime-test');
          assert.match(outcome.result.envelope.eventId, /^mre-/);
          assert.equal(outcome.result.envelope.emittedAt, '2026-04-15T10:00:00.000Z');
        }
      });
    }
  }
});

describe('mapRuntimeEventToEnvelope — S2 (audit-only suppression)', () => {
  for (const auditOnly of METHOD_AUDIT_ONLY_RUNTIME_EVENT_TYPES) {
    it(`${auditOnly} is audit-only`, () => {
      const outcome = mapRuntimeEventToEnvelope(ev(auditOnly), mapperConfig);
      assert.equal(outcome.kind, 'audit-only');
    });
  }
});

describe('mapRuntimeEventToEnvelope — unknown types', () => {
  it('returns kind=unknown for a type with no registry entry', () => {
    const outcome = mapRuntimeEventToEnvelope(ev('bogus.unknown_type'), mapperConfig);
    assert.equal(outcome.kind, 'unknown');
  });
});

describe('mapRuntimeEventOrThrow — G-CONNECTOR-TOPIC-ALLOWLIST', () => {
  it('throws on unknown type', () => {
    assert.throws(
      () => mapRuntimeEventOrThrow(ev('bogus.unknown'), mapperConfig),
      /no topic descriptor/,
    );
  });

  it('throws on audit-only type', () => {
    assert.throws(
      () => mapRuntimeEventOrThrow(ev('agent.text'), mapperConfig),
      /audit-only/,
    );
  });
});

describe('Discriminator injection (S6 §3.3)', () => {
  it('session.killed → method.session.ended with reason=killed', () => {
    const outcome = mapRuntimeEventToEnvelope(ev('session.killed'), mapperConfig);
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind === 'envelope') {
      assert.equal(outcome.result.envelope.payload.reason, 'killed');
    }
  });
  it('session.dead → method.session.ended with reason=crashed', () => {
    const outcome = mapRuntimeEventToEnvelope(ev('session.dead'), mapperConfig);
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind === 'envelope') {
      assert.equal(outcome.result.envelope.payload.reason, 'crashed');
    }
  });
  it('strategy.gate_passed → method.strategy.gate with result=passed', () => {
    const outcome = mapRuntimeEventToEnvelope(ev('strategy.gate_passed'), mapperConfig);
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind === 'envelope') {
      assert.equal(outcome.result.envelope.payload.result, 'passed');
    }
  });
  it('strategy.gate_failed → method.strategy.gate with result=failed', () => {
    const outcome = mapRuntimeEventToEnvelope(ev('strategy.gate_failed'), mapperConfig);
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind === 'envelope') {
      assert.equal(outcome.result.envelope.payload.result, 'failed');
    }
  });
});

describe('N4 (O8) — truncation of artifact_markdown', () => {
  it('truncates artifact_markdown > 32KB', () => {
    const bigMd = 'x'.repeat(50 * 1024);
    const outcome = mapRuntimeEventToEnvelope(
      ev('strategy.gate.awaiting_approval', { artifact_markdown: bigMd }),
      mapperConfig,
    );
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind !== 'envelope') return;
    const p = outcome.result.envelope.payload as Record<string, unknown>;
    const truncated = p.artifact_markdown as string;
    assert.ok(Buffer.byteLength(truncated, 'utf8') <= 32 * 1024);
    assert.equal(p.artifact_markdown_truncated, true);
    assert.equal(p.artifact_markdown_original_bytes, 50 * 1024);
    assert.ok(typeof p.artifact_ref === 'string');
    assert.match(p.artifact_ref as string, /^runtime-event:\/\//);
  });

  it('does NOT truncate when under threshold', () => {
    const smallMd = 'short artifact';
    const outcome = mapRuntimeEventToEnvelope(
      ev('strategy.gate.awaiting_approval', { artifact_markdown: smallMd }),
      mapperConfig,
    );
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind !== 'envelope') return;
    const p = outcome.result.envelope.payload as Record<string, unknown>;
    assert.equal(p.artifact_markdown, smallMd);
    assert.equal(p.artifact_markdown_truncated, undefined);
  });

  it('truncation respects UTF-8 codepoint boundaries', () => {
    // Build a string whose byte length cuts mid-multibyte.
    // Each emoji is 4 bytes in UTF-8. We'll build 10000 emojis (40k bytes).
    const bigMd = '😀'.repeat(10_000);
    const outcome = mapRuntimeEventToEnvelope(
      ev('strategy.gate.awaiting_approval', { artifact_markdown: bigMd }),
      mapperConfig,
    );
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind !== 'envelope') return;
    const p = outcome.result.envelope.payload as Record<string, unknown>;
    const truncated = p.artifact_markdown as string;
    // Decodable cleanly — no replacement char would have been inserted.
    assert.ok(!truncated.includes('\uFFFD'));
    assert.ok(Buffer.byteLength(truncated, 'utf8') <= 32 * 1024);
  });
});

describe('timestamp preservation', () => {
  it('does not resample emittedAt', () => {
    const fixed = '2020-01-01T00:00:00.000Z';
    const e: RuntimeEvent = { ...ev('session.spawned'), timestamp: fixed };
    const outcome = mapRuntimeEventToEnvelope(e, mapperConfig);
    assert.equal(outcome.kind, 'envelope');
    if (outcome.kind === 'envelope') {
      assert.equal(outcome.result.envelope.emittedAt, fixed);
    }
  });
});
