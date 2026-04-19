// SPDX-License-Identifier: Apache-2.0
/**
 * `runCortexAgentConformance` — the single CI entry point for a Cortex
 * `category: agent` tenant app. Runs each fixture against a fresh
 * `MockCortexCtx`, then runs every plugin against the recording. Emits a
 * `ComplianceReport` to `opts.outputPath` (if set) and returns it.
 *
 * Per S8 §5.1 + PRD-065 §10.2: the runner refuses any plugin list that drops
 * a DEFAULT_REQUIRED plugin or downgrades one to `required: false`.
 *
 * S8 §5.1: infrastructure faults throw `ConformanceRunError`; check failures
 * are fields on the returned report (never throws).
 */

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

// Structural mirrors — see cortex-types.ts. Real tenant apps pass in
// agent-runtime's CortexCtx / MethodAgentResult; structural typing makes
// them compatible with our mirror without a project reference.
import type { CortexCtx, MethodAgentResult } from './cortex-types.js';

import { ConformanceRunError } from './errors.js';
import type { ConformancePlugin } from './plugin.js';
import { DEFAULT_REQUIRED_PLUGIN_IDS } from './plugin.js';
import { createMockCortexCtx, type MockCortexCtx } from './mock-cortex-ctx.js';
import {
  type ComplianceReport,
  type FixtureRunResult,
  type PluginVerdict,
  type CheckVerdict,
  type Signer,
  canonicalizeReport,
  detectEnvFingerprint,
  serializeReport,
} from './compliance-report.js';
import type { ConformanceFixture } from './fixtures/index.js';
import { DEFAULT_FIXTURES } from './fixtures/index.js';
import { DEFAULT_PLUGINS } from './plugins/index.js';

// ── Constants ───────────────────────────────────────────────────

/** Stable version identifier for this testkit — matches package.json */
export const PACTA_TESTKIT_VERSION = '0.1.0';

// ── Options (S8 §5.1) ───────────────────────────────────────────

export interface ConformanceOptions {
  readonly app: (ctx: CortexCtx) => unknown | Promise<unknown>;
  readonly appId: string;
  readonly outputPath?: string;
  readonly fixtures?: ReadonlyArray<ConformanceFixture>;
  readonly plugins?: ReadonlyArray<ConformancePlugin>;
  readonly signer?: Signer;
  /** Optional key identifier written into `report.signature.keyId`. */
  readonly keyId?: string;
  readonly verbose?: boolean;
  /** Optional override of the app version placed in `report.app.version`. */
  readonly appVersion?: string;
}

// ── Required-plugin validation (PRD-065 §10.2) ──────────────────

export function validatePluginList(plugins: ReadonlyArray<ConformancePlugin>): void {
  const ids = new Set(plugins.map((p) => p.id));
  const missing = DEFAULT_REQUIRED_PLUGIN_IDS.filter((r) => !ids.has(r));
  if (missing.length > 0) {
    throw new ConformanceRunError('INVALID_FIXTURE', {
      detail: `required plugins missing: ${missing.join(', ')}`,
    });
  }
  for (const p of plugins) {
    if (
      (DEFAULT_REQUIRED_PLUGIN_IDS as ReadonlyArray<string>).includes(p.id) &&
      p.required === false
    ) {
      throw new ConformanceRunError('INVALID_FIXTURE', {
        detail: `plugin "${p.id}" must remain required; cannot override`,
      });
    }
  }
}

// ── Fixture execution ───────────────────────────────────────────

interface FixtureExecution {
  readonly ctx: MockCortexCtx;
  readonly result?: MethodAgentResult<unknown>;
  readonly error?: Error;
  readonly durationMs: number;
}

async function executeFixture(
  fixture: ConformanceFixture,
  appFn: (ctx: CortexCtx) => unknown | Promise<unknown>,
  appId: string,
): Promise<FixtureExecution> {
  const mock = createMockCortexCtx({ appId });
  for (const script of fixture.scriptedLlm) {
    mock.scriptLlmResponse(script);
  }
  // Surface the fixture id to the app via ctx.input. Real tenant apps
  // ignore it; test harnesses and the stub sample app read it to select
  // per-fixture behaviour.
  const ctxForApp: typeof mock = Object.assign({}, mock, {
    input: {
      ...(mock.input ?? {}),
      __conformanceFixtureId: fixture.id,
    },
  });
  const start = Date.now();
  try {
    const returned = await appFn(ctxForApp);
    const durationMs = Date.now() - start;
    const maybeResult = coerceMethodAgentResult(returned);
    return { ctx: mock, result: maybeResult, durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    const err = error instanceof Error ? error : new Error(String(error));
    return { ctx: mock, error: err, durationMs };
  }
}

/**
 * Heuristic: if the app returns something with the `appId` + `auditEventCount`
 * annotations (MethodAgentResult shape), surface it as such. Otherwise
 * MethodAgentResult is absent and C1 will fail.
 */
function coerceMethodAgentResult(value: unknown): MethodAgentResult<unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.appId === 'string' && typeof rec.auditEventCount === 'number') {
    return value as MethodAgentResult<unknown>;
  }
  return undefined;
}

// ── Main runner ─────────────────────────────────────────────────

export async function runCortexAgentConformance(
  opts: ConformanceOptions,
): Promise<ComplianceReport> {
  if (typeof opts.app !== 'function') {
    throw new ConformanceRunError('MISSING_APP', {
      detail: 'opts.app must be a function (ctx) => unknown | Promise<unknown>',
    });
  }

  const fixtures = opts.fixtures ?? DEFAULT_FIXTURES;
  const plugins = opts.plugins ?? DEFAULT_PLUGINS;
  validatePluginList(plugins);

  // Warn on unsigned-in-CI — S8 §7, mitigation for R3 (PRD-065 §13).
  if (!opts.signer && detectEnvFingerprint().ci) {
    // eslint-disable-next-line no-console
    console.warn(
      '[pacta-testkit/conformance] signer absent while CI=true; Cortex rejects unsigned reports in production.',
    );
  }

  const fixtureRuns: FixtureRunResult[] = [];
  const pluginInvocations = new Map<
    string,
    { plugin: ConformancePlugin; verdicts: CheckVerdict[] }
  >();
  for (const p of plugins) {
    pluginInvocations.set(p.id, { plugin: p, verdicts: [] });
  }

  for (const fixture of fixtures) {
    const execution = await executeFixture(fixture, opts.app, opts.appId);
    const recorder = execution.ctx.recorder;

    const callCounts = {
      audit: recorder.where('audit').length,
      llm: recorder.where('llm').filter((c) => c.method === 'complete').length,
      storage: recorder.where('storage').length,
      jobs: recorder.where('jobs').length,
      events: recorder.where('events').length,
      auth: recorder.where('auth').length,
    };

    let maxDepth = 0;
    for (const c of recorder.where('auth')) {
      const result = c.result as { token?: string } | undefined;
      if (result && typeof result.token === 'string') {
        const match = /^ext-token-d(\d+)$/.exec(result.token);
        if (match) {
          const n = Number.parseInt(match[1]!, 10);
          if (n > maxDepth) maxDepth = n;
        }
      }
    }

    const partial: Omit<FixtureRunResult, 'failedCheckIds' | 'passed'> = {
      fixtureId: fixture.id,
      durationMs: execution.durationMs,
      callCounts,
      maxDelegationDepth: maxDepth,
      ...(opts.verbose ? { recorderSnapshot: [...recorder.calls] } : {}),
    };

    const failedCheckIds: string[] = [];
    for (const entry of pluginInvocations.values()) {
      const { plugin } = entry;
      if (
        plugin.requiresFixtures &&
        plugin.requiresFixtures !== '*' &&
        !plugin.requiresFixtures.includes(fixture.id)
      ) {
        continue;
      }
      let verdicts: ReadonlyArray<CheckVerdict>;
      try {
        verdicts = await plugin.run({
          fixture,
          fixtureRun: partial,
          ctx: execution.ctx,
          recorder,
          agentResult: execution.result,
          invocationError: execution.error,
        });
      } catch (err) {
        throw new ConformanceRunError('PLUGIN_CRASH', {
          detail: `plugin "${plugin.id}" threw while running fixture "${fixture.id}"`,
          cause: err,
        });
      }
      for (const v of verdicts) {
        entry.verdicts.push(v);
        if (!v.passed && plugin.required) failedCheckIds.push(v.id);
      }
    }

    const runResult: FixtureRunResult = {
      ...partial,
      passed: failedCheckIds.length === 0,
      failedCheckIds,
    };
    fixtureRuns.push(runResult);
  }

  // Assemble plugin verdicts
  const pluginVerdicts: PluginVerdict[] = [];
  for (const { plugin, verdicts } of pluginInvocations.values()) {
    const allPassed = verdicts.every((v) => v.passed);
    pluginVerdicts.push({
      id: plugin.id,
      version: plugin.version,
      passed: allPassed,
      checks: verdicts,
    });
  }

  const requiredPlugins = plugins.filter((p) => p.required).map((p) => p.id);

  const passed =
    fixtureRuns.every((r) => r.passed) &&
    pluginVerdicts.filter((pv) => plugins.find((p) => p.id === pv.id)?.required).every((pv) => pv.passed);

  const failedFixtureIds = fixtureRuns.filter((r) => !r.passed).map((r) => r.fixtureId);
  const summary = passed
    ? `All ${fixtureRuns.length} fixtures passed against ${plugins.length} plugins.`
    : `Conformance failed on fixtures: ${failedFixtureIds.join(', ')}.`;

  const reportDraft: ComplianceReport = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    app: {
      id: opts.appId,
      ...(opts.appVersion !== undefined ? { version: opts.appVersion } : {}),
      pactaTestkitVersion: PACTA_TESTKIT_VERSION,
    },
    passed,
    summary,
    fixtureRuns,
    plugins: pluginVerdicts,
    requiredPlugins,
    env: detectEnvFingerprint(),
  };

  let finalReport: ComplianceReport = reportDraft;
  if (opts.signer) {
    const canonical = canonicalizeReport(reportDraft);
    let signatureValue: string;
    try {
      signatureValue = await opts.signer(canonical);
    } catch (err) {
      throw new ConformanceRunError('IO_ERROR', {
        detail: 'signer callback threw',
        cause: err,
      });
    }
    finalReport = {
      ...reportDraft,
      signature: {
        algorithm: 'ed25519',
        value: signatureValue,
        ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
      },
    };
  }

  if (opts.outputPath) {
    const resolved = path.isAbsolute(opts.outputPath)
      ? opts.outputPath
      : path.resolve(process.cwd(), opts.outputPath);
    try {
      await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
      await fsPromises.writeFile(resolved, serializeReport(finalReport), 'utf-8');
    } catch (err) {
      throw new ConformanceRunError('IO_ERROR', {
        detail: `failed to write compliance report to ${resolved}`,
        cause: err,
      });
    }
  }

  return finalReport;
}
