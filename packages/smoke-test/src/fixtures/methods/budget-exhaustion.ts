/**
 * Method fixture: budget exhaustion
 *
 * Agent with extremely tight budget. Mock provider simulates exceeding it.
 */

import type { Pact } from '@method/pacta';

export const METHOD_ID = 'budget-exhaustion';

export const pact: Pact = {
  mode: { type: 'oneshot' },
  budget: {
    maxCostUsd: 0.0001,
    onExhaustion: 'error',
  },
};

export const prompt = `Write a detailed essay about the history of computing from 1940 to present day.`;
