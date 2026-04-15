import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsPromises from 'node:fs/promises';
import * as crypto from 'node:crypto';

import {
  runCortexAgentConformance,
  validatePluginList,
  DEFAULT_PLUGINS,
  DEFAULT_FIXTURES,
  ConformanceRunError,
  s1MethodAgentPortPlugin,
  createEd25519Signer,
  canonicalizeReport,
} from '../index.js';
import { passAllFixturesApp } from './sample-app.js';

async function tmpPath(): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pacta-conformance-'));
  return path.join(dir, 'compliance-report.json');
}

describe('runCortexAgentConformance — runner', () => {
  it('passes all canonical fixtures with the sample conforming app', async () => {
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      outputPath: await tmpPath(),
    });
    assert.equal(report.schemaVersion, '1.0');
    assert.equal(report.passed, true, `summary: ${report.summary}`);
    assert.equal(report.fixtureRuns.length, 3);
    for (const run of report.fixtureRuns) {
      assert.equal(
        run.passed,
        true,
        `fixture ${run.fixtureId} failed: ${run.failedCheckIds.join(',')}`,
      );
    }
  });

  it('throws ConformanceRunError(INVALID_FIXTURE) when required plugins missing', async () => {
    await assert.rejects(
      () =>
        runCortexAgentConformance({
          app: passAllFixturesApp,
          appId: 'stub-app',
          plugins: [],
        }),
      (err: unknown) =>
        err instanceof ConformanceRunError &&
        err.code === 'INVALID_FIXTURE' &&
        /required plugins missing/.test(err.message),
    );
  });

  it('throws ConformanceRunError(INVALID_FIXTURE) when required plugin downgraded', async () => {
    const downgraded = { ...s1MethodAgentPortPlugin, required: false };
    await assert.rejects(
      () =>
        runCortexAgentConformance({
          app: passAllFixturesApp,
          appId: 'stub-app',
          plugins: [downgraded, DEFAULT_PLUGINS[1]!],
        }),
      (err: unknown) =>
        err instanceof ConformanceRunError &&
        err.code === 'INVALID_FIXTURE' &&
        /must remain required/.test(err.message),
    );
  });

  it('throws ConformanceRunError(MISSING_APP) when app not a function', async () => {
    await assert.rejects(
      () =>
        runCortexAgentConformance({
          app: undefined as unknown as (ctx: unknown) => unknown,
          appId: 'x',
        }),
      (err: unknown) => err instanceof ConformanceRunError && err.code === 'MISSING_APP',
    );
  });

  it('writes a schema-valid ComplianceReport.json to outputPath', async () => {
    const output = await tmpPath();
    await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      outputPath: output,
    });
    const text = await fsPromises.readFile(output, 'utf-8');
    const parsed = JSON.parse(text);
    assert.equal(parsed.schemaVersion, '1.0');
    assert.equal(typeof parsed.passed, 'boolean');
    assert.ok(Array.isArray(parsed.plugins));
    assert.ok(Array.isArray(parsed.fixtureRuns));
    assert.deepEqual(parsed.requiredPlugins, [
      's1-method-agent-port',
      's3-service-adapters',
    ]);
  });

  it('when signer provided, attaches signature field with algorithm + base64 value', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const signer = createEd25519Signer(pem);
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      signer,
      keyId: 'kid-42',
    });
    assert.ok(report.signature);
    assert.equal(report.signature!.algorithm, 'ed25519');
    assert.equal(report.signature!.keyId, 'kid-42');
    const canonical = canonicalizeReport(report);
    const ok = crypto.verify(
      null,
      canonical,
      publicKey,
      Buffer.from(report.signature!.value, 'base64'),
    );
    assert.equal(ok, true);
  });

  it('omits signature field when signer absent', async () => {
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
    });
    assert.equal(report.signature, undefined);
  });

  it('produces passed=false when app does not return MethodAgentResult', async () => {
    const badApp = async (): Promise<unknown> => ({ notAMethodAgentResult: true });
    const report = await runCortexAgentConformance({
      app: badApp,
      appId: 'bad-app',
    });
    assert.equal(report.passed, false);
    for (const run of report.fixtureRuns) {
      assert.ok(run.failedCheckIds.includes('S1-C1-invokes-via-createMethodAgent'));
    }
  });

  it('validatePluginList accepts DEFAULT_PLUGINS', () => {
    assert.doesNotThrow(() => validatePluginList(DEFAULT_PLUGINS));
  });

  it('allows a caller-extended plugin list that preserves the required set', async () => {
    const extra = {
      id: 'custom-plugin',
      version: '0.0.1',
      description: 'custom',
      required: false,
      async run(): Promise<[]> {
        return [];
      },
    };
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      plugins: [...DEFAULT_PLUGINS, extra],
    });
    assert.equal(report.plugins.length, 3);
    assert.equal(report.plugins.find((p) => p.id === 'custom-plugin')?.passed, true);
  });

  it('honours opts.fixtures override (single fixture)', async () => {
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      fixtures: [DEFAULT_FIXTURES[0]!],
    });
    assert.equal(report.fixtureRuns.length, 1);
    assert.equal(report.fixtureRuns[0]!.fixtureId, 'incident-triage');
  });

  it('plugin.requiresFixtures restricts which fixtures the plugin runs on', async () => {
    let runCount = 0;
    const restricted = {
      id: 'restricted-plugin',
      version: '0.0.1',
      description: 'restricted',
      requiresFixtures: ['incident-triage'] as const,
      required: false,
      async run(): Promise<[]> {
        runCount += 1;
        return [];
      },
    };
    await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      plugins: [...DEFAULT_PLUGINS, restricted],
    });
    assert.equal(runCount, 1);
  });

  it('recorderSnapshot is attached when verbose=true', async () => {
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'stub-app',
      verbose: true,
    });
    for (const run of report.fixtureRuns) {
      assert.ok(Array.isArray(run.recorderSnapshot));
      assert.ok(run.recorderSnapshot!.length > 0);
    }
  });

  it('throws ConformanceRunError(PLUGIN_CRASH) when a plugin throws', async () => {
    const crashy = {
      id: 'crashy-plugin',
      version: '0.0.1',
      description: 'throws',
      required: false,
      async run(): Promise<[]> {
        throw new Error('boom');
      },
    };
    await assert.rejects(
      () =>
        runCortexAgentConformance({
          app: passAllFixturesApp,
          appId: 'stub-app',
          plugins: [...DEFAULT_PLUGINS, crashy],
        }),
      (err: unknown) =>
        err instanceof ConformanceRunError && err.code === 'PLUGIN_CRASH',
    );
  });
});
