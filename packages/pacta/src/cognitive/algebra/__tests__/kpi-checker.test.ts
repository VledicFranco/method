/**
 * Tests for KPIChecker DSL parser + mock adapter (PRD 049).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDSL, buildCheckableKPIFromDSL } from '../kpi-checker-port.js';
import { createMockKPIChecker } from '../kpi-checker-slm.js';
import type { VerificationState } from '../verification.js';

function makeState(files: Record<string, string>): VerificationState {
  return {
    files: new Map(Object.entries(files)),
    lastAction: { tool: 'Write', input: {}, result: 'ok' },
    actionHistory: [],
  };
}

describe('KPIChecker DSL parser', () => {
  it('parses file_exists primitive', () => {
    const check = parseDSL("file_exists('src/handlers/v2.ts')");
    assert.ok(check);
    const state = makeState({ 'src/handlers/v2.ts': 'content' });
    assert.equal(check!(state).met, true);
    assert.equal(check!(makeState({})).met, false);
  });

  it('parses file_contains primitive', () => {
    const check = parseDSL("file_contains('src/foo.ts', 'handleOrderV2')");
    assert.ok(check);
    assert.equal(check!(makeState({ 'src/foo.ts': 'export function handleOrderV2() {}' })).met, true);
    assert.equal(check!(makeState({ 'src/foo.ts': 'other content' })).met, false);
  });

  it('parses file_exports primitive', () => {
    const check = parseDSL("file_exports('src/foo.ts', 'handleOrderV2')");
    assert.ok(check);
    assert.equal(check!(makeState({ 'src/foo.ts': 'export function handleOrderV2() {}' })).met, true);
    assert.equal(check!(makeState({ 'src/foo.ts': 'function handleOrderV2() {}' })).met, false);
  });

  it('composes primitives with &&', () => {
    const check = parseDSL("file_exists('src/v2.ts') && file_exports('src/v2.ts', 'handleOrderV2')");
    assert.ok(check);
    const state1 = makeState({ 'src/v2.ts': 'export function handleOrderV2() {}' });
    assert.equal(check!(state1).met, true);
    const state2 = makeState({ 'src/v2.ts': 'function handleOrderV2() {}' });
    assert.equal(check!(state2).met, false);
  });

  it('handles triple composition', () => {
    const check = parseDSL("file_exists('a.ts') && file_exists('b.ts') && file_contains('a.ts', 'foo')");
    assert.ok(check);
    assert.equal(check!(makeState({ 'a.ts': 'foo bar', 'b.ts': 'x' })).met, true);
    assert.equal(check!(makeState({ 'a.ts': 'bar', 'b.ts': 'x' })).met, false);
  });

  it('handles double-quoted strings', () => {
    const check = parseDSL('file_exists("src/foo.ts")');
    assert.ok(check);
    assert.equal(check!(makeState({ 'src/foo.ts': 'x' })).met, true);
  });

  it('returns null for unparseable DSL', () => {
    assert.equal(parseDSL('garbage output'), null);
    assert.equal(parseDSL('unknown_primitive(x)'), null);
    assert.equal(parseDSL(''), null);
    assert.equal(parseDSL('file_exists()'), null);  // missing arg
  });

  it('returns null when any primitive is unparseable', () => {
    const check = parseDSL("file_exists('a.ts') && bad_thing(y)");
    assert.equal(check, null);
  });
});

describe('buildCheckableKPIFromDSL', () => {
  it('builds CheckableKPI with check when DSL parseable', () => {
    const kpi = buildCheckableKPIFromDSL('v2 handler exists', "file_exists('src/v2.ts')");
    assert.equal(kpi.description, 'v2 handler exists');
    assert.equal(kpi.met, false);
    assert.ok(kpi.check);
  });

  it('builds description-only CheckableKPI when DSL unparseable', () => {
    const kpi = buildCheckableKPIFromDSL('something vague', 'garbage');
    assert.equal(kpi.description, 'something vague');
    assert.equal(kpi.check, undefined);
  });
});

describe('Mock KPIChecker adapter', () => {
  it('returns checkable KPI for known input', async () => {
    const checker = createMockKPIChecker(new Map([
      ['v2 handler exists', "file_exists('src/v2.ts')"],
    ]));
    const results = await checker.generateChecks([
      { kpi: 'v2 handler exists', context: { objective: 'test', knownPaths: [], knownIdentifiers: [] } },
    ]);
    assert.equal(results.length, 1);
    assert.ok(results[0].check);
  });

  it('returns description-only for unknown input', async () => {
    const checker = createMockKPIChecker(new Map());
    const results = await checker.generateChecks([
      { kpi: 'unknown kpi', context: { objective: 'test', knownPaths: [], knownIdentifiers: [] } },
    ]);
    assert.equal(results[0].check, undefined);
  });

  it('batches multiple inputs', async () => {
    const checker = createMockKPIChecker(new Map([
      ['a', "file_exists('a.ts')"],
      ['b', "file_exists('b.ts')"],
    ]));
    const results = await checker.generateChecks([
      { kpi: 'a', context: { objective: 't', knownPaths: [], knownIdentifiers: [] } },
      { kpi: 'b', context: { objective: 't', knownPaths: [], knownIdentifiers: [] } },
    ]);
    assert.equal(results.length, 2);
    assert.ok(results[0].check);
    assert.ok(results[1].check);
  });

  it('reports model + version', () => {
    const checker = createMockKPIChecker(new Map());
    assert.equal(checker.model, 'mock-kpi-checker');
    assert.equal(checker.version, 'test');
  });
});
