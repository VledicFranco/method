// SPDX-License-Identifier: Apache-2.0
/**
 * Methodology lifecycle fixture — mock methodology, methods, and steps
 * for smoke testing the methodology/method/step layer.
 *
 * Defines a simple methodology "SMOKE-TEST-METH" with:
 *   - Method "analyze" with 3 steps: [gather, assess, report]
 *   - Method "implement" with 2 steps: [design, code]
 *
 * Constructs real Methodology<S> / Method<S> / Step<S> values using
 * @methodts/methodts core types. The execution functions are stubbed
 * since the smoke test mock only reads structure (DAG, predicates),
 * never runs step logic.
 */

import type {
  Method,
  Methodology,
  Predicate,
  DomainTheory,
  Step,
  StepDAG,
  StepExecution,
} from '@methodts/methodts';
import { check } from '@methodts/methodts';
import type { CatalogMethodologyEntry } from '@methodts/methodts/stdlib';

// ── State type ────────────────────────────────────────────────────

type S = Record<string, unknown>;

// ── Step builder helper ──────────────────────────────────────────

/** Build a script step with a stubbed execution (never called in mock). */
function makeStep(
  id: string,
  role: string,
  pre: Predicate<S>,
  post: Predicate<S>,
): Step<S> {
  // The execution is typed as StepExecution<S> but never invoked.
  // We stub it to avoid importing 'effect' in the smoke-test package.
  const execution = {
    tag: 'script' as const,
    execute: () => { throw new Error('stub — not for execution'); },
  } as unknown as StepExecution<S>;

  return {
    id,
    name: id,
    role,
    precondition: pre,
    postcondition: post,
    execution,
  };
}

// ── Method builder helper ────────────────────────────────────────

function makeMethod(
  id: string,
  name: string,
  domain: DomainTheory<S>,
  steps: Step<S>[],
  objective: Predicate<S>,
): Method<S> {
  const edges = steps.slice(0, -1).map((s, i) => ({ from: s.id, to: steps[i + 1].id }));
  const dag: StepDAG<S> = {
    steps,
    edges,
    initial: steps[0].id,
    terminal: steps[steps.length - 1].id,
  };
  return { id, name, domain, roles: [], dag, objective, measures: [] };
}

// ── Predicates ────────────────────────────────────────────────────

const needsAnalysis: Predicate<S> = check<S>(
  'needs_analysis(challenge)',
  () => true,
);

const analysisComplete: Predicate<S> = check<S>(
  'analysis_complete(challenge)',
  () => false,
);

const needsImplementation: Predicate<S> = check<S>(
  'needs_implementation(challenge)',
  () => true,
);

const allDone: Predicate<S> = check<S>(
  'all_done(challenge)',
  () => false,
);

// ── Domain Theory ─────────────────────────────────────────────────

const DOMAIN: DomainTheory<S> = {
  id: 'D_SMOKE_TEST',
  signature: {
    sorts: [
      { name: 'Challenge', description: 'A test challenge', cardinality: 'finite' },
      { name: 'Artifact', description: 'A produced artifact', cardinality: 'unbounded' },
    ],
    functionSymbols: [],
    predicates: {
      needs_analysis: needsAnalysis,
      analysis_complete: analysisComplete,
      needs_implementation: needsImplementation,
      all_done: allDone,
    },
  },
  axioms: {},
};

// ── Steps ─────────────────────────────────────────────────────────

const gatherStep = makeStep(
  'gather', 'analyst',
  check<S>('challenge_defined', () => true),
  check<S>('data_gathered', () => true),
);

const assessStep = makeStep(
  'assess', 'analyst',
  check<S>('data_gathered', () => true),
  check<S>('assessment_complete', () => true),
);

const reportStep = makeStep(
  'report', 'analyst',
  check<S>('assessment_complete', () => true),
  check<S>('report_delivered', () => true),
);

const designStep = makeStep(
  'design', 'engineer',
  check<S>('requirements_defined', () => true),
  check<S>('design_complete', () => true),
);

const codeStep = makeStep(
  'code', 'engineer',
  check<S>('design_complete', () => true),
  check<S>('code_complete', () => true),
);

// ── Methods ───────────────────────────────────────────────────────

export const analyzeMethod: Method<S> = makeMethod(
  'M-ANALYZE',
  'Analyze Challenge',
  DOMAIN,
  [gatherStep, assessStep, reportStep],
  check<S>('analysis_complete', () => true),
);

export const implementMethod: Method<S> = makeMethod(
  'M-IMPLEMENT',
  'Implement Solution',
  DOMAIN,
  [designStep, codeStep],
  check<S>('implementation_complete', () => true),
);

// ── Methodology ───────────────────────────────────────────────────

export const smokeTestMethodology: Methodology<S> = {
  id: 'SMOKE-TEST-METH',
  name: 'Smoke Test Methodology',
  domain: DOMAIN,
  arms: [
    {
      priority: 1,
      label: 'terminate',
      condition: allDone,
      selects: null,
      rationale: 'Terminate when all work is done.',
    },
    {
      priority: 2,
      label: 'analyze',
      condition: needsAnalysis,
      selects: analyzeMethod,
      rationale: 'Start with analysis if challenge needs it.',
    },
    {
      priority: 3,
      label: 'implement',
      condition: needsImplementation,
      selects: implementMethod,
      rationale: 'Implement once analysis is done.',
    },
  ],
  objective: allDone,
  terminationCertificate: {
    measure: () => 1,
    decreases: 'Smoke test terminates after one cycle.',
  },
  safety: {
    maxLoops: 5,
    maxTokens: 100_000,
    maxCostUsd: 10,
    maxDurationMs: 60_000,
    maxDepth: 3,
  },
};

// ── Catalog entry (mirrors CatalogMethodologyEntry shape) ─────────

export const smokeTestCatalogEntry: CatalogMethodologyEntry = {
  methodologyId: 'SMOKE-TEST-METH',
  name: 'Smoke Test Methodology',
  description: 'A test methodology with two methods (analyze, implement) for smoke testing.',
  version: '1.0',
  status: 'compiled',
  methods: [
    {
      methodId: 'M-ANALYZE',
      name: 'Analyze Challenge',
      description: 'Gather data, assess, and report findings.',
      stepCount: 3,
      status: 'compiled',
      version: '1.0',
    },
    {
      methodId: 'M-IMPLEMENT',
      name: 'Implement Solution',
      description: 'Design and code a solution.',
      stepCount: 2,
      status: 'compiled',
      version: '1.0',
    },
  ],
};
