// SPDX-License-Identifier: Apache-2.0
/**
 * Method fixture: reflexion reasoning
 *
 * Agent with reflectOnFailure enabled. Mock provider simulates a failure
 * on first attempt, triggering self-critique (reflection event), then
 * succeeds on retry.
 */

import type { Pact } from '@methodts/pacta';

export const METHOD_ID = 'reasoning-reflexion';

export const pact: Pact = {
  mode: { type: 'oneshot' },
  reasoning: {
    reflectOnFailure: true,
    maxReflectionTrials: 2,
  },
};

export const prompt = `Solve this step by step: What is the sum of all prime numbers less than 20?`;
