/**
 * PRD-063 architecture gates.
 *
 * Gates covered:
 *   G-CONNECTOR-RUNTIME-IMPORTS-ONLY — static import-scan of
 *     event-connector.ts: must only import from @method/runtime/ports,
 *     never from @method/bridge or @method/runtime/event-bus internals.
 *   G-CONNECTOR-TOPIC-ALLOWLIST — mapRuntimeEventOrThrow throws on
 *     unknown topic.
 *   G-AUDIT-SUPERSET — every METHOD_TOPIC_REGISTRY source type has an
 *     audit-map entry.
 *   G-PORT — CortexEventConnector implements EventConnector structurally.
 *   G-LAYER — src/cortex/ imports no disallowed packages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { EventConnector } from '@method/runtime/ports';

import { CortexEventConnector } from './event-connector.js';
import {
  mapRuntimeEventOrThrow,
  type EnvelopeMapperConfig,
} from './event-envelope-mapper.js';
import {
  METHOD_TOPIC_REGISTRY,
  METHOD_RUNTIME_EVENT_AUDIT_MAP,
} from './event-topic-registry.js';
import type { CortexEventsCtx } from './ctx-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('G-CONNECTOR-RUNTIME-IMPORTS-ONLY', () => {
  it('event-connector.ts does not import from @method/bridge', () => {
    const src = readFileSync(join(HERE, 'event-connector.ts'), 'utf-8');
    assert.doesNotMatch(src, /from\s+['"]@method\/bridge/);
  });

  it('event-connector.ts does not import from runtime event-bus internals', () => {
    const src = readFileSync(join(HERE, 'event-connector.ts'), 'utf-8');
    assert.doesNotMatch(src, /from\s+['"]@method\/runtime\/event-bus/);
    assert.doesNotMatch(src, /from\s+['"]@method\/runtime\/src\/event-bus/);
  });

  it('event-connector.ts imports runtime types from @method/runtime/ports only', () => {
    const src = readFileSync(join(HERE, 'event-connector.ts'), 'utf-8');
    assert.match(src, /from\s+['"]@method\/runtime\/ports['"]/);
  });
});

describe('G-CONNECTOR-TOPIC-ALLOWLIST', () => {
  const cfg: EnvelopeMapperConfig = { appId: 'test' };

  it('mapRuntimeEventOrThrow throws on unknown type', () => {
    assert.throws(
      () =>
        mapRuntimeEventOrThrow(
          {
            id: 'x',
            version: 1,
            timestamp: '2026-04-15T00:00:00Z',
            sequence: 1,
            domain: 'session',
            type: 'absolutely.bogus',
            severity: 'info',
            payload: {},
            source: 'test',
          },
          cfg,
        ),
      /no topic descriptor/,
    );
  });

  it('CortexEventConnector constructor rejects bogus allowedTopics', () => {
    const ctx: CortexEventsCtx = {
      async emit() {
        return { eventId: 'x', subscriberCount: 0 };
      },
    };
    assert.throws(
      () =>
        new CortexEventConnector(
          { appId: 'a', allowedTopics: new Set(['method.nope']) },
          ctx,
        ),
    );
  });
});

describe('G-AUDIT-SUPERSET', () => {
  it('every METHOD_TOPIC_REGISTRY source type has an audit-map entry', () => {
    const missing: string[] = [];
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const src of desc.sourceEventTypes) {
        if (!METHOD_RUNTIME_EVENT_AUDIT_MAP.has(src)) missing.push(src);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('G-PORT — CortexEventConnector implements EventConnector', () => {
  it('satisfies EventConnector interface structurally', () => {
    const ctx: CortexEventsCtx = {
      async emit() {
        return { eventId: 'x', subscriberCount: 0 };
      },
    };
    const c = new CortexEventConnector(
      { appId: 'a', allowedTopics: new Set(['method.session.started']) },
      ctx,
    );
    // Force the structural check at compile time.
    const port: EventConnector = c;
    assert.equal(typeof port.connect, 'function');
    assert.equal(typeof port.disconnect, 'function');
    assert.equal(typeof port.health, 'function');
    assert.equal(typeof port.onEvent, 'function');
    assert.equal(typeof port.name, 'string');
  });
});

describe('G-LAYER — no disallowed imports in src/cortex/', () => {
  const FILES = [
    'event-connector.ts',
    'event-envelope-mapper.ts',
    'event-topic-registry.ts',
    'manifest-emit-section.ts',
    'internal/buffer.ts',
    'internal/rate-limiter.ts',
    'internal/publish-retry.ts',
    'internal/audit-dual-write.ts',
  ];
  // Packages higher or laterally-inappropriate to import
  const FORBIDDEN = [
    '@method/bridge',
    '@method/cluster',
    '@method/mcp',
    'fastify',
    'node-pty',
    '@t1/cortex-sdk',
    '@cortex/',
  ];

  for (const file of FILES) {
    for (const bad of FORBIDDEN) {
      it(`${file} does not import ${bad}`, () => {
        const src = readFileSync(join(HERE, file), 'utf-8');
        const re = new RegExp(
          `from\\s+['"]${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        );
        assert.doesNotMatch(src, re);
      });
    }
  }
});
