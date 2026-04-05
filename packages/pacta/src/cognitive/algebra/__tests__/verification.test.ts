/**
 * Tests for verification types and check primitives (PRD 048 Wave 0+1).
 *
 * Covers: type construction, fileExists, fileContains, fileExports,
 * fileCountChanged, allChecks, anyCheck composition.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  fileExists,
  fileContains,
  fileExports,
  fileCountChanged,
  allChecks,
  anyCheck,
} from '../verification.js';
import type { VerificationState, CheckableKPI, VerificationResult, CorrectionSignal } from '../verification.js';

// ── Helpers ────────────────────────────────────────────────────

function makeState(files: Record<string, string>, lastTool = 'Write'): VerificationState {
  return {
    files: new Map(Object.entries(files)),
    lastAction: { tool: lastTool, input: {}, result: 'ok' },
    actionHistory: [{ tool: lastTool, cycle: 1 }],
  };
}

// ── Type Construction ──────────────────────────────────────────

describe('Verification types: construction', () => {
  it('CheckableKPI with check function', () => {
    const kpi: CheckableKPI = {
      description: 'v2 handler created',
      check: fileExists('src/v2.ts'),
      met: false,
      evidence: '',
    };
    assert.equal(kpi.description, 'v2 handler created');
    assert.equal(typeof kpi.check, 'function');
  });

  it('CheckableKPI without check (LLM fallback)', () => {
    const kpi: CheckableKPI = {
      description: 'code is clean',
      met: false,
      evidence: '',
    };
    assert.equal(kpi.check, undefined);
  });

  it('VerificationResult construction', () => {
    const result: VerificationResult = {
      verified: false,
      kpiStatus: [{ kpi: 'file exists', met: false, evidence: 'missing' }],
      diagnosis: 'file was not created',
    };
    assert.equal(result.verified, false);
    assert.equal(result.kpiStatus.length, 1);
  });

  it('CorrectionSignal construction', () => {
    const signal: CorrectionSignal = {
      problem: 'handleOrderV2 not exported',
      suggestion: 'Add export keyword',
      unmetKPIs: ['v2 handler exported'],
      failureCount: 1,
    };
    assert.equal(signal.failureCount, 1);
    assert.equal(signal.unmetKPIs.length, 1);
  });
});

// ── fileExists ─────────────────────────────────────────────────

describe('Check primitives: fileExists', () => {
  it('returns met=true when file exists', () => {
    const state = makeState({ 'src/v2.ts': 'content' });
    const result = fileExists('src/v2.ts')(state);
    assert.equal(result.met, true);
    assert.ok(result.evidence.includes('exists'));
  });

  it('returns met=false when file missing', () => {
    const state = makeState({});
    const result = fileExists('src/v2.ts')(state);
    assert.equal(result.met, false);
    assert.ok(result.evidence.includes('does not exist'));
  });
});

// ── fileContains ───────────────────────────────────────────────

describe('Check primitives: fileContains', () => {
  it('matches string pattern', () => {
    const state = makeState({ 'src/v2.ts': 'export function handleOrderV2() {}' });
    const result = fileContains('src/v2.ts', 'handleOrderV2')(state);
    assert.equal(result.met, true);
  });

  it('matches regex pattern', () => {
    const state = makeState({ 'src/v2.ts': 'export function handleOrderV2() {}' });
    const result = fileContains('src/v2.ts', /export\s+function\s+handleOrderV2/)(state);
    assert.equal(result.met, true);
  });

  it('returns false when pattern not found', () => {
    const state = makeState({ 'src/v2.ts': 'const x = 1;' });
    const result = fileContains('src/v2.ts', 'handleOrderV2')(state);
    assert.equal(result.met, false);
  });

  it('returns false when file missing', () => {
    const state = makeState({});
    const result = fileContains('src/v2.ts', 'anything')(state);
    assert.equal(result.met, false);
    assert.ok(result.evidence.includes('does not exist'));
  });
});

// ── fileExports ────────────────────────────────────────────────

describe('Check primitives: fileExports', () => {
  it('detects export function', () => {
    const state = makeState({ 'src/v2.ts': 'export function handleOrderV2(req: Request) { return {}; }' });
    const result = fileExports('src/v2.ts', 'handleOrderV2')(state);
    assert.equal(result.met, true);
  });

  it('detects export const', () => {
    const state = makeState({ 'src/config.ts': 'export const AppConfig = { port: 3000 };' });
    const result = fileExports('src/config.ts', 'AppConfig')(state);
    assert.equal(result.met, true);
  });

  it('detects export interface', () => {
    const state = makeState({ 'src/types.ts': 'export interface IEventBus { on(): void; }' });
    const result = fileExports('src/types.ts', 'IEventBus')(state);
    assert.equal(result.met, true);
  });

  it('detects named export in braces', () => {
    const state = makeState({ 'src/index.ts': 'export { handleOrderV2 } from "./v2";' });
    const result = fileExports('src/index.ts', 'handleOrderV2')(state);
    assert.equal(result.met, true);
  });

  it('returns false when not exported', () => {
    const state = makeState({ 'src/v2.ts': 'function handleOrderV2() {}' });
    const result = fileExports('src/v2.ts', 'handleOrderV2')(state);
    assert.equal(result.met, false);
  });

  it('returns false when file missing', () => {
    const state = makeState({});
    const result = fileExports('src/v2.ts', 'handleOrderV2')(state);
    assert.equal(result.met, false);
  });
});

// ── fileCountChanged ───────────────────────────────────────────

describe('Check primitives: fileCountChanged', () => {
  it('detects expected new files', () => {
    const initial = new Map([['src/v1.ts', 'original']]);
    const state = makeState({ 'src/v1.ts': 'original', 'src/v2.ts': 'new', 'src/types.ts': 'new' });
    const result = fileCountChanged(2, initial)(state);
    assert.equal(result.met, true);
    assert.ok(result.evidence.includes('2 new files'));
  });

  it('fails when not enough new files', () => {
    const initial = new Map([['src/v1.ts', 'original']]);
    const state = makeState({ 'src/v1.ts': 'original', 'src/v2.ts': 'new' });
    const result = fileCountChanged(3, initial)(state);
    assert.equal(result.met, false);
  });
});

// ── Composition ────────────────────────────────────────────────

describe('Check primitives: composition', () => {
  it('allChecks passes when all pass', () => {
    const state = makeState({ 'src/v2.ts': 'export function handleOrderV2() {}' });
    const result = allChecks(
      fileExists('src/v2.ts'),
      fileExports('src/v2.ts', 'handleOrderV2'),
    )(state);
    assert.equal(result.met, true);
  });

  it('allChecks fails when one fails', () => {
    const state = makeState({ 'src/v2.ts': 'function handleOrderV2() {}' });
    const result = allChecks(
      fileExists('src/v2.ts'),
      fileExports('src/v2.ts', 'handleOrderV2'),
    )(state);
    assert.equal(result.met, false);
    assert.ok(result.evidence.includes('does not export'));
  });

  it('anyCheck passes when one passes', () => {
    const state = makeState({ 'src/v2.ts': 'const x = 1;' });
    const result = anyCheck(
      fileExports('src/v2.ts', 'handleOrderV2'),
      fileExists('src/v2.ts'),
    )(state);
    assert.equal(result.met, true);
  });

  it('anyCheck fails when all fail', () => {
    const state = makeState({});
    const result = anyCheck(
      fileExists('src/v2.ts'),
      fileExists('src/v3.ts'),
    )(state);
    assert.equal(result.met, false);
  });
});
