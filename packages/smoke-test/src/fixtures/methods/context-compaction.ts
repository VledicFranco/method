// SPDX-License-Identifier: Apache-2.0
/**
 * Method fixture: context compaction
 *
 * Agent with compaction policy. Live-mode only — needs real provider
 * to trigger context_compacted event on long conversations.
 */

import type { Pact } from '@methodts/pacta';

export const METHOD_ID = 'context-compaction';

export const pact: Pact = {
  mode: { type: 'oneshot' },
  context: {
    strategy: 'compact',
    compactionThreshold: 0.5,
    compactionInstructions: 'Summarize the key findings so far.',
  },
  budget: { maxTurns: 10, maxCostUsd: 0.50 },
};

export const prompt = `Analyze the following large text and provide a structured summary with key themes, arguments, and conclusions. The text is: "Software architecture is the set of structures needed to reason about a software system. Architecture is about the important stuff, whatever that is." Expand on this quote at length, then summarize your own expansion.`;
