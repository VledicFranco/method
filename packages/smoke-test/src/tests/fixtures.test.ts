/**
 * Fixture validation tests — verifies all YAML fixtures parse correctly
 * via the methodts strategy parser, and all method fixtures import cleanly.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrategyYaml } from '@method/methodts/strategy/dag-parser.js';
import { load as loadYaml } from 'js-yaml';
import { strategyCases, allCases, allFeatures, casesByLayer } from '../cases/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATEGY_DIR = join(__dirname, '..', 'fixtures', 'strategies');

// ── YAML fixture parsing ────────────────────────────────────────

describe('Strategy YAML fixtures: parse validation', () => {
  const yamlFiles = readdirSync(STRATEGY_DIR).filter((f) => f.endsWith('.yaml'));

  it('has at least 25 strategy fixtures', () => {
    expect(yamlFiles.length).toBeGreaterThanOrEqual(25);
  });

  for (const file of yamlFiles) {
    // dag-validation-errors.yaml is intentionally invalid (duplicate IDs)
    if (file === 'dag-validation-errors.yaml') {
      it(`${file} — intentionally invalid (duplicate node IDs)`, () => {
        const content = readFileSync(join(STRATEGY_DIR, file), 'utf8');
        const raw = loadYaml(content) as { strategy: { dag: { nodes: Array<{ id: string }> } } };
        const ids = raw.strategy.dag.nodes.map((n) => n.id);
        const hasDuplicates = new Set(ids).size !== ids.length;
        expect(hasDuplicates, 'should have duplicate node IDs').toBe(true);
      });
      continue;
    }

    it(`${file} — parses as valid StrategyDAG`, () => {
      const content = readFileSync(join(STRATEGY_DIR, file), 'utf8');
      const dag = parseStrategyYaml(content);
      expect(dag.id).toBeTruthy();
      expect(dag.nodes.length).toBeGreaterThan(0);
    });
  }
});

// ── Test case registry ──────────────────────────────────────────

describe('Test case registry', () => {
  it('has at least 30 total cases', () => {
    expect(allCases.size).toBeGreaterThanOrEqual(30);
  });

  it('has cases at strategy, methodology, and agent layers', () => {
    expect(casesByLayer('strategy').length).toBeGreaterThan(0);
    expect(casesByLayer('methodology').length).toBeGreaterThan(0);
    expect(casesByLayer('agent').length).toBeGreaterThan(0);
  });

  it('all features are tagged', () => {
    const features = allFeatures();
    expect(features.length).toBeGreaterThan(20);
  });

  it('every strategy case references an existing fixture', () => {
    for (const c of strategyCases) {
      const fixturePath = join(__dirname, '..', 'fixtures', c.fixture);
      const content = readFileSync(fixturePath, 'utf8');
      expect(content.length, `fixture ${c.fixture} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('every case has at least one feature tag', () => {
    for (const c of allCases.values()) {
      expect(c.features.length, `case ${c.id} should have features`).toBeGreaterThan(0);
    }
  });

  it('every case has expected.status', () => {
    for (const c of allCases.values()) {
      expect(['completed', 'failed', 'suspended']).toContain(c.expected.status);
    }
  });
});

// ── Integration: run a simple script fixture ────────────────────

describe('Mock executor: script node integration', () => {
  it('runs node-script.yaml end-to-end with mock executor', async () => {
    // Inline import to avoid circular deps at module level
    const { runMockStrategy, loadFixtureYaml } = await import('../executor/mock-executor.js');
    const { checkResult, allPassed } = await import('../executor/result-checker.js');

    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'node-script.yaml'));
    const { result } = await runMockStrategy(yaml, {
      contextInputs: { a: 10, b: 20 },
    });

    expect(result.status).toBe('completed');

    // Script node should have computed sum = 30
    const sumArtifact = result.artifacts['sum'];
    expect(sumArtifact).toBeDefined();
    expect(sumArtifact.content).toBe(30);

    // Run through result checker
    const assertions = checkResult(result, {
      status: 'completed',
      artifactsProduced: ['sum'],
      artifactValues: { sum: 30 },
    });
    expect(allPassed(assertions)).toBe(true);
  });

  it('runs artifact-passing.yaml: 3-node chain', async () => {
    const { runMockStrategy, loadFixtureYaml } = await import('../executor/mock-executor.js');

    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'artifact-passing.yaml'));
    const { result } = await runMockStrategy(yaml);

    expect(result.status).toBe('completed');
    expect(result.artifacts['intermediate']).toBeDefined();
    expect(result.artifacts['final']).toBeDefined();
  });

  it('runs retro-generation.yaml: verifies retro fields', async () => {
    const { runMockStrategy, loadFixtureYaml } = await import('../executor/mock-executor.js');

    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'retro-generation.yaml'));
    const { result } = await runMockStrategy(yaml);

    expect(result.status).toBe('completed');
    expect(result.started_at).toBeTruthy();
    expect(result.completed_at).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.artifacts['step1']).toBeDefined();
    expect(result.artifacts['step2']).toBeDefined();
  });
});
