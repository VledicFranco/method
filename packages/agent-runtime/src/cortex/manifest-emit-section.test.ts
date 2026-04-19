// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for generate-manifest-emit-section — PRD-063 §Tests.
 *
 * Covers:
 *   - returns 21 entries matching registry
 *   - honors topic subset option
 *   - emits both yaml + json
 *   - CLI parses flags correctly
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateManifestEmitSection,
  emitEntriesToYaml,
  cliMain,
} from './manifest-emit-section.js';
import { METHOD_TOPIC_REGISTRY } from './event-topic-registry.js';

describe('generateManifestEmitSection', () => {
  it('returns an entry per registry topic', () => {
    const entries = generateManifestEmitSection();
    assert.equal(entries.length, METHOD_TOPIC_REGISTRY.length);
    assert.equal(entries.length, 37);
    const topics = new Set(entries.map((e) => e.type));
    for (const d of METHOD_TOPIC_REGISTRY) {
      assert.ok(topics.has(d.topic), `missing topic ${d.topic}`);
    }
  });

  it('honors topics subset option', () => {
    const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
      topics: new Set(['method.session.started', 'method.session.ended']),
    });
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.type).sort(),
      ['method.session.ended', 'method.session.started'],
    );
  });

  it('node_modules mode uses node_modules prefix for schema path', () => {
    const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
      topics: new Set(['method.session.started']),
      schemaRefMode: 'node_modules',
    });
    assert.match(entries[0].schema, /node_modules\/@methodts\/agent-runtime/);
  });

  it('copied mode uses copied prefix', () => {
    const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
      topics: new Set(['method.session.started']),
      schemaRefMode: 'copied',
      copiedSchemaPrefix: './my-schemas/',
    });
    assert.ok(entries[0].schema.startsWith('./my-schemas/'));
  });

  it('carries descriptions and classifications', () => {
    const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
      topics: new Set(['method.strategy.gate.awaiting_approval']),
    });
    assert.equal(entries.length, 1);
    assert.ok(entries[0].description);
    assert.ok(entries[0].classifications.length >= 1);
    assert.equal(entries[0].classifications[0].level, 2);
  });
});

describe('emitEntriesToYaml', () => {
  it('produces valid YAML block', () => {
    const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
      topics: new Set(['method.session.started']),
    });
    const yaml = emitEntriesToYaml(entries);
    assert.match(yaml, /^emit:/);
    assert.match(yaml, /- type: "method\.session\.started"/);
    assert.match(yaml, /schemaVersion: 1/);
    assert.match(yaml, /classifications:/);
  });

  it('emits empty list for no entries', () => {
    assert.equal(emitEntriesToYaml([]), 'emit: []\n');
  });

  it('escapes double-quotes in strings', () => {
    const yaml = emitEntriesToYaml([
      {
        type: 'method.test',
        schema: './x',
        classifications: [],
        description: 'quote: "yes"',
        schemaVersion: 1,
      },
    ]);
    assert.match(yaml, /description: "quote: \\"yes\\""/);
  });
});

describe('cliMain', () => {
  it('default yaml output lists all registry topics', () => {
    const out = cliMain(['node', 'script']);
    assert.match(out, /^emit:/);
    const matches = out.match(/- type:/g);
    assert.equal(matches?.length, 37);
  });

  it('--format=json returns a JSON array', () => {
    const out = cliMain(['node', 'script', '--format=json']);
    const parsed = JSON.parse(out);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 37);
  });

  it('--topics filters', () => {
    const out = cliMain(['node', 'script', '--format=json', '--topics=method.session.started']);
    const parsed = JSON.parse(out);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, 'method.session.started');
  });

  it('--help returns help text', () => {
    const out = cliMain(['node', 'script', '--help']);
    assert.match(out, /generate-manifest-emit-section/);
  });
});
