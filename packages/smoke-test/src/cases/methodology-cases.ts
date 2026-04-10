/**
 * Methodology/method/step layer smoke test case definitions.
 *
 * These test the methodology session lifecycle: listing, starting,
 * routing, selecting, stepping, validating, and transitioning.
 * All cases use the mock methodology executor (no bridge server needed).
 */

import type { SmokeTestCase } from './index.js';

export const methodologyCases: SmokeTestCase[] = [
  // ── Methodology layer (L4) ───────────────────────────────────

  {
    id: 'methodology-list-and-start',
    name: 'List methodologies and start session',
    description:
      'Discover methodologies via list(), start a session. Verify session state is "initialized".',
    category: 'methodology',
    layer: 'methodology',
    features: ['methodology-start', 'methodology-list'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'methodology-routing-inspection',
    name: 'Routing inspection',
    description:
      'Call getRouting() and verify transition function returns arms with priorities, predicates with descriptions.',
    category: 'methodology',
    layer: 'methodology',
    features: ['routing-inspection'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'methodology-route-evaluation',
    name: 'Route evaluation',
    description:
      'Start session, call route() with challenge predicates. Verify correct arm matches.',
    category: 'methodology',
    layer: 'methodology',
    features: ['route-evaluation'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'methodology-select-method',
    name: 'Select method after routing',
    description:
      'After routing, call select(). Verify method loads, step DAG initialized, first step accessible.',
    category: 'methodology',
    layer: 'methodology',
    features: ['method-selection'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'methodology-full-lifecycle',
    name: 'Full methodology lifecycle',
    description:
      'Start -> route -> select -> step through all steps -> transition -> verify completion or re-route.',
    category: 'methodology',
    layer: 'methodology',
    features: [
      'methodology-start',
      'route-evaluation',
      'method-selection',
      'methodology-transition',
    ],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
      retroGenerated: true,
    },
  },
  {
    id: 'methodology-session-status',
    name: 'Session status',
    description:
      'Start session, load method, check status returns correct method/step/progress.',
    category: 'methodology',
    layer: 'methodology',
    features: ['methodology-status'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'methodology-session-isolation',
    name: 'Session isolation',
    description:
      'Start two sessions with different IDs. Advance in one. Verify other unaffected.',
    category: 'methodology',
    layer: 'methodology',
    features: ['session-isolation'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },

  // ── Method layer (L3) ────────────────────────────────────────

  {
    id: 'step-inspect-current',
    name: 'Inspect current step',
    description:
      'Load a method, call getCurrentStep(). Verify step details: id, name, role, pre/postcondition, guidance.',
    category: 'methodology',
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
    category: 'methodology',
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
    category: 'methodology',
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
    category: 'methodology',
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
    category: 'methodology',
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
    category: 'methodology',
    layer: 'method',
    features: ['step-preconditions'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
];
