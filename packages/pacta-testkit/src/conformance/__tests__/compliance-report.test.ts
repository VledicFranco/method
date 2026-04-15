import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {
  canonicalizeReport,
  createEd25519Signer,
  detectEnvFingerprint,
  serializeReport,
  type ComplianceReport,
} from '../compliance-report.js';

function baseReport(): ComplianceReport {
  return {
    schemaVersion: '1.0',
    generatedAt: '2026-04-14T00:00:00.000Z',
    app: { id: 'app-1', pactaTestkitVersion: '0.1.0' },
    passed: true,
    summary: 'ok',
    fixtureRuns: [],
    plugins: [],
    requiredPlugins: ['s1-method-agent-port', 's3-service-adapters'],
    env: { nodeVersion: 'v20.0.0', os: 'linux-x64', ci: false },
  };
}

describe('ComplianceReport — schema + canonicalization', () => {
  it('canonicalizeReport excludes signature and sorts keys', () => {
    const r = baseReport();
    const bytes = canonicalizeReport(r);
    const text = new TextDecoder().decode(bytes);
    // No signature in canonical bytes
    assert.equal(text.includes('"signature"'), false);
    // Keys sorted — 'app' before 'env' before 'fixtureRuns', etc.
    const appIdx = text.indexOf('"app"');
    const envIdx = text.indexOf('"env"');
    assert.ok(appIdx > 0 && appIdx < envIdx);
  });

  it('canonical bytes are stable regardless of field order on input', () => {
    const a = baseReport();
    const b: ComplianceReport = {
      env: a.env,
      requiredPlugins: a.requiredPlugins,
      plugins: a.plugins,
      fixtureRuns: a.fixtureRuns,
      summary: a.summary,
      passed: a.passed,
      app: a.app,
      generatedAt: a.generatedAt,
      schemaVersion: a.schemaVersion,
    };
    const ba = canonicalizeReport(a);
    const bb = canonicalizeReport(b);
    assert.deepEqual([...ba], [...bb]);
  });

  it('canonicalization signs identically with signature added after', () => {
    const r = baseReport();
    const c1 = canonicalizeReport(r);
    const c2 = canonicalizeReport({
      ...r,
      signature: { algorithm: 'ed25519', value: 'deadbeef' },
    });
    assert.deepEqual([...c1], [...c2]);
  });

  it('createEd25519Signer produces a verifiable signature', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const signer = createEd25519Signer(pem, 'kid-1');
    const r = baseReport();
    const canonical = canonicalizeReport(r);
    const sig = await signer(canonical);
    const ok = crypto.verify(null, canonical, publicKey, Buffer.from(sig, 'base64'));
    assert.equal(ok, true);
  });

  it('detectEnvFingerprint reports nodeVersion and os', () => {
    const env = detectEnvFingerprint();
    assert.equal(typeof env.nodeVersion, 'string');
    assert.ok(env.nodeVersion.startsWith('v'));
    assert.equal(typeof env.os, 'string');
    assert.ok(env.os.includes('-'));
    assert.equal(typeof env.ci, 'boolean');
  });

  it('serializeReport produces valid JSON', () => {
    const r = baseReport();
    const text = serializeReport(r);
    const parsed = JSON.parse(text);
    assert.equal(parsed.schemaVersion, '1.0');
    assert.equal(parsed.app.id, 'app-1');
  });
});
