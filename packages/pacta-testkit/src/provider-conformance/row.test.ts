// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for `runProviderConformanceRow`.
 *
 * Exercises the row runner against synthetic providers — one that
 * passes every check, one that lies about capabilities, and one that
 * emits malformed oneshot results. No real provider package imported.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AgentProvider,
  AgentResult,
  ProviderCapabilities,
  SchemaDefinition,
  Pact,
  AgentRequest,
} from '@methodts/pacta';

import { runProviderConformanceRow, type ProviderConformanceRow } from './index.js';

// ── Scaffolding ───────────────────────────────────────────────────

function makeResult(output: string): AgentResult<string> {
  return {
    output,
    sessionId: 'test-session',
    completed: true,
    stopReason: 'complete',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
    },
    cost: { totalUsd: 0.0001, perModel: {} },
    durationMs: 10,
    turns: 1,
  };
}

const passingCapabilities: ProviderCapabilities = {
  modes: ['oneshot'],
  streaming: false,
  resumable: false,
  budgetEnforcement: 'client',
  outputValidation: 'client',
  toolModel: 'none',
};

function makeSyntheticProvider(caps: ProviderCapabilities): AgentProvider {
  return {
    name: 'synthetic',
    capabilities: () => caps,
    invoke: async <T>(_pact: Pact<T>, _req: AgentRequest): Promise<AgentResult<T>> => {
      return makeResult('ok') as unknown as AgentResult<T>;
    },
  };
}

const stringSchema: SchemaDefinition<string> = {
  parse(raw) {
    if (typeof raw === 'string') return { success: true, data: raw };
    return { success: false, errors: ['expected string'] };
  },
  description: 'any string',
};

// ── Tests ─────────────────────────────────────────────────────────

describe('runProviderConformanceRow', () => {
  it('passes every check when the provider conforms', async () => {
    const row: ProviderConformanceRow = {
      id: 'synthetic-passing',
      expectedCapabilities: passingCapabilities,
      makeProvider: () => makeSyntheticProvider(passingCapabilities),
      runOneshot: async () => makeResult('hello'),
      outputSchema: stringSchema,
    };

    const report = await runProviderConformanceRow(row);

    assert.equal(report.passed, true);
    assert.equal(report.rowId, 'synthetic-passing');
    assert.deepEqual(
      report.checks.map((c) => c.name),
      ['capabilities', 'oneshot', 'outputValidation'],
    );
    assert.ok(report.checks.every((c) => c.passed));
  });

  it('fails capabilities check when provider reports different modes', async () => {
    const row: ProviderConformanceRow = {
      id: 'synthetic-bad-caps',
      expectedCapabilities: passingCapabilities,
      // Provider claims oneshot+resumable but the row expects oneshot only.
      makeProvider: () => makeSyntheticProvider({
        ...passingCapabilities,
        modes: ['oneshot', 'resumable'],
        resumable: true,
      }),
      runOneshot: async () => makeResult('hello'),
      outputSchema: stringSchema,
    };

    const report = await runProviderConformanceRow(row);

    assert.equal(report.passed, false);
    const caps = report.checks.find((c) => c.name === 'capabilities');
    assert.ok(caps && !caps.passed);
    assert.match(caps.error ?? '', /modes:/);
  });

  it('fails oneshot check when required result fields are missing', async () => {
    const row: ProviderConformanceRow = {
      id: 'synthetic-bad-oneshot',
      expectedCapabilities: passingCapabilities,
      makeProvider: () => makeSyntheticProvider(passingCapabilities),
      // Return a result with a non-numeric durationMs.
      runOneshot: async () => ({
        ...makeResult('hello'),
        durationMs: -1,
      }),
      outputSchema: stringSchema,
    };

    const report = await runProviderConformanceRow(row);

    assert.equal(report.passed, false);
    const oneshot = report.checks.find((c) => c.name === 'oneshot');
    assert.ok(oneshot && !oneshot.passed);
    assert.match(oneshot.error ?? '', /durationMs/);
  });

  it('fails outputValidation check when output does not parse against schema', async () => {
    const numberSchema: SchemaDefinition<number> = {
      parse(raw) {
        if (typeof raw === 'number') return { success: true, data: raw };
        return { success: false, errors: ['expected number'] };
      },
    };

    const row: ProviderConformanceRow<number> = {
      id: 'synthetic-bad-output',
      expectedCapabilities: passingCapabilities,
      makeProvider: () => makeSyntheticProvider(passingCapabilities),
      runOneshot: async () => makeResult('not-a-number') as unknown as AgentResult<number>,
      outputSchema: numberSchema,
    };

    const report = await runProviderConformanceRow(row);

    assert.equal(report.passed, false);
    const outVal = report.checks.find((c) => c.name === 'outputValidation');
    assert.ok(outVal && !outVal.passed);
    assert.match(outVal.error ?? '', /did not parse/);
  });

  it('skips remaining checks when capabilities assertion itself throws', async () => {
    const row: ProviderConformanceRow = {
      id: 'synthetic-broken-factory',
      expectedCapabilities: passingCapabilities,
      makeProvider: () => {
        throw new Error('factory failed');
      },
      runOneshot: async () => makeResult('hello'),
      outputSchema: stringSchema,
    };

    const report = await runProviderConformanceRow(row);

    assert.equal(report.passed, false);
    assert.equal(report.checks.length, 3);
    assert.ok(report.checks.every((c) => !c.passed));
    // oneshot + outputValidation are reported as skipped, not run.
    assert.match(report.checks[1].error ?? '', /skipped/);
    assert.match(report.checks[2].error ?? '', /skipped/);
  });
});
