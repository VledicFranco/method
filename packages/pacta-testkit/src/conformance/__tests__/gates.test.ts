// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as mod from '../index.js';
import { runCortexAgentConformance } from '../index.js';
import { passAllFixturesApp } from './sample-app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFORMANCE_DIR = path.resolve(__dirname, '..');

/** Walk .ts files under a directory, skipping __tests__ and any test files. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...walkSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('G-BOUNDARY — no value imports from @methodts/agent-runtime in conformance/', () => {
  it('scans conformance source files', () => {
    const files = walkSourceFiles(CONFORMANCE_DIR);
    assert.ok(files.length > 0, 'expected at least one source file');
    const violations: string[] = [];
    const valueImport = /^\s*import\s+(?!type\b)[^;]*from\s+['"]@methodts\/agent-runtime['"]/gm;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (valueImport.test(content)) violations.push(file);
    }
    assert.deepEqual(violations, []);
  });
});

describe('G-PORT — conformance subpath exports match the S8 frozen symbol set', () => {
  it('exports expected symbols', () => {
    const expected = [
      'runCortexAgentConformance',
      'createMockCortexCtx',
      'incidentTriageFixture',
      'featureDevCommissionFixture',
      'dailyReportFixture',
      'DEFAULT_FIXTURES',
      'DEFAULT_PLUGINS',
      's1MethodAgentPortPlugin',
      's3ServiceAdaptersPlugin',
      'ConformanceRunError',
      'canonicalizeReport',
      'createEd25519Signer',
      'detectEnvFingerprint',
      'DEFAULT_REQUIRED_PLUGIN_IDS',
      'validatePluginList',
      'PACTA_TESTKIT_VERSION',
    ];
    for (const name of expected) {
      assert.ok(
        name in mod,
        `missing export: ${name}`,
      );
    }
  });
});

describe('G-LAYER — no imports from @methodts/bridge or higher layers', () => {
  it('scans conformance source files', () => {
    const files = walkSourceFiles(CONFORMANCE_DIR);
    const forbidden = /@methodts\/(bridge|mcp|methodts|cluster)/g;
    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (forbidden.test(content)) violations.push(file);
    }
    assert.deepEqual(violations, []);
  });
});

describe('G-SCHEMA — runner output parses as ComplianceReport v1.0', () => {
  it('produces a schemaVersion=1.0 report with required fields', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pacta-gate-'));
    const outputPath = path.join(dir, 'compliance-report.json');
    const report = await runCortexAgentConformance({
      app: passAllFixturesApp,
      appId: 'gate-test',
      outputPath,
    });
    assert.equal(report.schemaVersion, '1.0');
    assert.equal(typeof report.passed, 'boolean');
    assert.ok(Array.isArray(report.plugins));
    assert.ok(Array.isArray(report.fixtureRuns));
    assert.ok(Array.isArray(report.requiredPlugins));
    assert.ok(report.env);
    assert.equal(typeof report.env.nodeVersion, 'string');

    const written = JSON.parse(await fsPromises.readFile(outputPath, 'utf-8'));
    assert.equal(written.schemaVersion, '1.0');
  });
});
