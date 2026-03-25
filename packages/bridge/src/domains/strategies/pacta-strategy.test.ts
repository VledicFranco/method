import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPactFromStrategyConfig,
  resolveStepPact,
  validatePactPipeline,
  type PactStrategyConfig,
  type PactStrategyPipeline,
} from './pacta-strategy.js';

// ── Tests: buildPactFromStrategyConfig ──────────────────────────

describe('pacta-strategy: buildPactFromStrategyConfig', () => {
  it('builds a minimal pact with oneshot mode', () => {
    const config: PactStrategyConfig = { label: 'step-1' };
    const pact = buildPactFromStrategyConfig(config);
    assert.deepStrictEqual(pact.mode, { type: 'oneshot' });
    assert.strictEqual(pact.budget, undefined);
    assert.strictEqual(pact.scope, undefined);
    assert.strictEqual(pact.reasoning, undefined);
  });

  it('maps budget constraints to BudgetContract', () => {
    const config: PactStrategyConfig = {
      label: 'implementation',
      budget: {
        maxCostUsd: 2.0,
        maxDurationMs: 300_000,
        maxTurns: 50,
        maxTokens: 100_000,
        onExhaustion: 'stop',
      },
    };
    const pact = buildPactFromStrategyConfig(config);
    assert.deepStrictEqual(pact.budget, {
      maxCostUsd: 2.0,
      maxDurationMs: 300_000,
      maxTurns: 50,
      maxTokens: 100_000,
      onExhaustion: 'stop',
    });
  });

  it('maps scope constraints to ScopeContract', () => {
    const config: PactStrategyConfig = {
      label: 'review',
      scope: {
        allowedTools: ['Read', 'Grep', 'Glob'],
        deniedTools: ['Write', 'Bash'],
        allowedPaths: ['packages/bridge/**'],
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'auto',
      },
    };
    const pact = buildPactFromStrategyConfig(config);
    assert.deepStrictEqual(pact.scope, {
      allowedTools: ['Read', 'Grep', 'Glob'],
      deniedTools: ['Write', 'Bash'],
      allowedPaths: ['packages/bridge/**'],
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'auto',
    });
  });

  it('maps reasoning config to ReasoningPolicy', () => {
    const config: PactStrategyConfig = {
      label: 'analysis',
      reasoning: {
        effort: 'high',
        thinkTool: true,
        planBetweenActions: true,
        reflectOnFailure: true,
      },
    };
    const pact = buildPactFromStrategyConfig(config);
    assert.deepStrictEqual(pact.reasoning, {
      effort: 'high',
      thinkTool: true,
      planBetweenActions: true,
      reflectOnFailure: true,
    });
  });

  it('builds a full pact with all sections', () => {
    const config: PactStrategyConfig = {
      label: 'full-step',
      budget: { maxCostUsd: 1.0, maxTurns: 10 },
      scope: { model: 'claude-haiku-4-5-20241022' },
      reasoning: { effort: 'low' },
    };
    const pact = buildPactFromStrategyConfig(config);
    assert.deepStrictEqual(pact.mode, { type: 'oneshot' });
    assert.strictEqual(pact.budget?.maxCostUsd, 1.0);
    assert.strictEqual(pact.scope?.model, 'claude-haiku-4-5-20241022');
    assert.strictEqual(pact.reasoning?.effort, 'low');
  });
});

// ── Tests: resolveStepPact ──────────────────────────────────────

describe('pacta-strategy: resolveStepPact', () => {
  it('returns default pact when step not found and no defaults', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'test-pipeline',
      steps: {},
    };
    const pact = resolveStepPact(pipeline, 'missing');
    assert.deepStrictEqual(pact.mode, { type: 'oneshot' });
    assert.strictEqual(pact.budget, undefined);
  });

  it('returns pipeline defaults when step not found but defaults exist', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'test-pipeline',
      defaults: {
        budget: { maxCostUsd: 0.5 },
      },
      steps: {},
    };
    const pact = resolveStepPact(pipeline, 'missing');
    assert.strictEqual(pact.budget?.maxCostUsd, 0.5);
  });

  it('returns step-specific pact when step exists', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'test-pipeline',
      steps: {
        'implement': {
          label: 'implement',
          budget: { maxCostUsd: 2.0 },
        },
      },
    };
    const pact = resolveStepPact(pipeline, 'implement');
    assert.strictEqual(pact.budget?.maxCostUsd, 2.0);
  });

  it('merges defaults with step-specific config (step wins)', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'test-pipeline',
      defaults: {
        budget: { maxCostUsd: 0.5, maxTurns: 10 },
        scope: { model: 'claude-haiku-4-5-20241022' },
      },
      steps: {
        'implement': {
          label: 'implement',
          budget: { maxCostUsd: 5.0 },
          scope: { allowedPaths: ['packages/**'] },
        },
      },
    };
    const pact = resolveStepPact(pipeline, 'implement');
    // Step's maxCostUsd wins over default
    assert.strictEqual(pact.budget?.maxCostUsd, 5.0);
    // Default's maxTurns preserved
    assert.strictEqual(pact.budget?.maxTurns, 10);
    // Step's allowedPaths applied
    assert.deepStrictEqual(pact.scope?.allowedPaths, ['packages/**']);
    // Default's model preserved
    assert.strictEqual(pact.scope?.model, 'claude-haiku-4-5-20241022');
  });
});

// ── Tests: validatePactPipeline ─────────────────────────────────

describe('pacta-strategy: validatePactPipeline', () => {
  it('returns no warnings for valid pipeline', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'valid-pipeline',
      steps: {
        'step-1': {
          label: 'step-1',
          budget: { maxCostUsd: 1.0, maxTurns: 10 },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 0);
  });

  it('warns on zero budget cost', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'bad-budget',
      steps: {
        'step-1': {
          label: 'step-1',
          budget: { maxCostUsd: 0 },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('maxCostUsd'));
  });

  it('warns on zero turns', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'bad-turns',
      steps: {
        'step-1': {
          label: 'step-1',
          budget: { maxTurns: 0 },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('maxTurns'));
  });

  it('warns on negative duration', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'bad-duration',
      steps: {
        'step-1': {
          label: 'step-1',
          budget: { maxDurationMs: -1000 },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('maxDurationMs'));
  });

  it('warns on empty allowedTools', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'no-tools',
      steps: {
        'step-1': {
          label: 'step-1',
          scope: { allowedTools: [] },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('allowedTools'));
  });

  it('collects multiple warnings', () => {
    const pipeline: PactStrategyPipeline = {
      name: 'multiple-issues',
      steps: {
        'step-1': {
          label: 'step-1',
          budget: { maxCostUsd: 0, maxTurns: -1 },
          scope: { allowedTools: [] },
        },
      },
    };
    const warnings = validatePactPipeline(pipeline);
    assert.strictEqual(warnings.length, 3);
  });
});
