/**
 * Methodology-layer smoke test case definitions.
 *
 * These test the methodology session lifecycle: listing, starting,
 * routing, selecting, transitioning. All cases use the mock methodology
 * executor (no bridge server needed).
 *
 * Method-layer (step DAG) cases were migrated to method-cases.ts as part
 * of PRD 056 C-6. See that file for step-* cases.
 */

import type { SmokeTestCase } from './index.js';

export const methodologyCases: SmokeTestCase[] = [
  // ── Methodology layer (L4) ───────────────────────────────────

  {
    id: 'methodology-list-and-start',
    name: 'List methodologies and start session',
    description:
      'Discover methodologies via list(), start a session. Verify session state is "initialized".',
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
    layer: 'methodology',
    features: ['session-isolation'],
    fixture: 'methods/methodology-lifecycle.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
];
