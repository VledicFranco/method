/**
 * Tests for event-topic-registry — PRD-063 §Tests.
 *
 * Covers:
 *   - S1: registry has exactly 21 entries (frozen count, S6 §3.3)
 *   - G-AUDIT-SUPERSET: every sourceEventType has an audit-map entry
 *   - RUNTIME_EVENT_TYPE_TO_TOPIC lookup is correct
 *   - No duplicate sourceEventTypes across topics
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_TOPIC_REGISTRY,
  METHOD_TOPIC_COUNT,
  METHOD_RUNTIME_EVENT_AUDIT_MAP,
  RUNTIME_EVENT_TYPE_TO_TOPIC,
} from './event-topic-registry.js';

describe('METHOD_TOPIC_REGISTRY', () => {
  it('S6 §3.3 + PRD-068 S10: ships 24 core runtime topics + 13 cortical-workspace topics = 37 total', () => {
    // S6 §3.3 summary line states "21 distinct topics" but the enumerated
    // mapping table lists 24 unique topic names after applying the
    // documented merges (session.killed+dead → ended, gate_passed+failed
    // → gate, bridge_* → bridge_state, recovery_* → recovery). We ship
    // 24 faithful to the mapping table; the "21" summary is a counting
    // typo in S6 that does not affect the frozen data.
    //
    // PRD-068 S10 extends the registry with the `method.cortex.workspace.*`
    // topic family — 13 topics for the cognitive-module coordination
    // substrate. Extension (not mutation) is allowed per S6 §2.3 (new
    // topics can be appended without re-freezing the surface).
    assert.equal(METHOD_TOPIC_COUNT, 37);
    assert.equal(METHOD_TOPIC_REGISTRY.length, 37);
  });

  it('PRD-068 S10: 13 method.cortex.workspace.* topics registered', () => {
    const workspace = METHOD_TOPIC_REGISTRY.filter((d) =>
      d.topic.startsWith('method.cortex.workspace.'),
    );
    assert.equal(workspace.length, 13);
  });

  it('every topic name is prefixed with method.', () => {
    for (const desc of METHOD_TOPIC_REGISTRY) {
      assert.ok(desc.topic.startsWith('method.'), `topic ${desc.topic} missing method. prefix`);
    }
  });

  it('every topic has a non-empty sourceEventTypes array', () => {
    for (const desc of METHOD_TOPIC_REGISTRY) {
      assert.ok(desc.sourceEventTypes.length >= 1, `topic ${desc.topic} has no source types`);
    }
  });

  it('every topic has schemaVersion 1 in v1 registry', () => {
    for (const desc of METHOD_TOPIC_REGISTRY) {
      assert.equal(desc.schemaVersion, 1, `topic ${desc.topic} unexpected schemaVersion`);
    }
  });

  it('classifications use only valid levels (0|1|2|3)', () => {
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const c of desc.classifications) {
        assert.ok([0, 1, 2, 3].includes(c.level), `${desc.topic} bad level ${c.level}`);
      }
    }
  });

  it('no duplicate sourceEventType across topics', () => {
    const seen = new Map<string, string>();
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const src of desc.sourceEventTypes) {
        if (seen.has(src)) {
          assert.fail(`duplicate sourceEventType '${src}' in '${desc.topic}' and '${seen.get(src)}'`);
        }
        seen.set(src, desc.topic);
      }
    }
  });

  it('session.killed + session.dead both map to method.session.ended', () => {
    const ended = METHOD_TOPIC_REGISTRY.find((d) => d.topic === 'method.session.ended');
    assert.ok(ended);
    assert.ok(ended!.sourceEventTypes.includes('session.killed'));
    assert.ok(ended!.sourceEventTypes.includes('session.dead'));
  });

  it('strategy.gate_passed + strategy.gate_failed both map to method.strategy.gate', () => {
    const gate = METHOD_TOPIC_REGISTRY.find((d) => d.topic === 'method.strategy.gate');
    assert.ok(gate);
    assert.ok(gate!.sourceEventTypes.includes('strategy.gate_passed'));
    assert.ok(gate!.sourceEventTypes.includes('strategy.gate_failed'));
  });
});

describe('RUNTIME_EVENT_TYPE_TO_TOPIC', () => {
  it('lookup resolves session.spawned to method.session.started', () => {
    const desc = RUNTIME_EVENT_TYPE_TO_TOPIC.get('session.spawned');
    assert.ok(desc);
    assert.equal(desc!.topic, 'method.session.started');
  });

  it('returns undefined for unknown type', () => {
    assert.equal(RUNTIME_EVENT_TYPE_TO_TOPIC.get('nonexistent.type'), undefined);
  });
});

describe('G-AUDIT-SUPERSET', () => {
  it('every RuntimeEvent type in the registry has an audit-map entry (compile-time)', () => {
    const missing: string[] = [];
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const src of desc.sourceEventTypes) {
        if (!METHOD_RUNTIME_EVENT_AUDIT_MAP.has(src)) {
          missing.push(src);
        }
      }
    }
    assert.deepEqual(missing, [], `G-AUDIT-SUPERSET violation: ${missing.join(', ')}`);
  });

  it('audit-map size ≥ unique source type count', () => {
    const uniqueSrcTypes = new Set<string>();
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const s of desc.sourceEventTypes) uniqueSrcTypes.add(s);
    }
    assert.ok(METHOD_RUNTIME_EVENT_AUDIT_MAP.size >= uniqueSrcTypes.size);
  });
});
