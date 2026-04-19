// SPDX-License-Identifier: Apache-2.0
/**
 * Method-layer (step DAG) smoke test case definitions.
 *
 * These test the step execution lifecycle: step_current, step_context,
 * step_advance, step_validate, step precondition/postcondition handling.
 *
 * Migrated verbatim from methodology-cases.ts (introduced in 311d325) as
 * part of PRD 056 C-6. Each case targets a single step-execution feature
 * and reuses the methodology-lifecycle.ts fixture.
 *
 * Coverage target (SC-4): all five step-execution features must resolve
 * to at least one case in this file.
 *   - step-current       → method-step-inspect-current
 *   - step-context       → method-step-context-assembly
 *   - step-advance       → method-step-advance-through-dag
 *   - step-validate      → method-step-validate-pass, method-step-validate-fail
 *   - step-preconditions → method-step-precondition-display
 *
 * Execution routing note: at the time of migration, server.ts routes
 * `testCase.layer === 'methodology'` through MethodologyMock. The mock
 * itself handles both methodology- and step-level operations, but the
 * outer branch in server.ts does not yet include `'method'`. The case
 * IDs here are preserved from their original handlers in server.ts so
 * that a single-line routing fix (adding `|| testCase.layer === 'method'`)
 * will re-enable execution without further edits.
 */

import type { SmokeTestCase } from './index.js';

export const methodCases: SmokeTestCase[] = [
  {
    id: 'step-inspect-current',
    name: 'Inspect current step',
    description:
      'Load a method, call getCurrentStep(). Verify step details: id, name, role, pre/postcondition, guidance.',
    layer: 'method',
    features: ['step-current'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'step-context-assembly',
    name: 'Step context assembly',
    description:
      'Advance through two steps, checking context at each. Verify prior outputs appear in context.',
    layer: 'method',
    features: ['step-context'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'step-advance-through-dag',
    name: 'Advance through DAG',
    description:
      'Advance through all steps in a method. Verify order, terminal step throws on further advance.',
    layer: 'method',
    features: ['step-advance'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'step-validate-pass',
    name: 'Step validation (pass)',
    description:
      'Submit valid output to validateStep(). Verify postcondition met, recommendation "advance".',
    layer: 'method',
    features: ['step-validate'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'step-validate-fail',
    name: 'Step validation (fail)',
    description:
      'Submit invalid output. Verify recommendation "retry" (the test verifies that validation correctly rejects bad output).',
    layer: 'method',
    features: ['step-validate'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'step-precondition-display',
    name: 'Step precondition display',
    description:
      'Load a method with check predicates. Verify precondition labels extracted correctly.',
    layer: 'method',
    features: ['step-preconditions'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
];
