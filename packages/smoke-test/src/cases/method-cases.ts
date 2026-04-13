/**
 * Method-layer (step DAG) smoke test case definitions.
 *
 * These test the step execution lifecycle: step_current, step_context,
 * step_advance, step_validate, step precondition/postcondition handling.
 *
 * Wave 0 stub — C-6 populates with 5+ cases covering:
 *   step-current, step-context, step-advance, step-validate, step-preconditions
 *
 * Note: the redesign branch currently holds 6 method-layer cases inside
 * methodology-cases.ts (tagged `layer: 'method'`). C-6 audits and migrates
 * them here.
 */

import type { SmokeTestCase } from './index.js';

export const methodCases: SmokeTestCase[] = [];
