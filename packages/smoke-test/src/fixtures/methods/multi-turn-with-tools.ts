// SPDX-License-Identifier: Apache-2.0
/**
 * Method fixture: multi-turn with tool use
 *
 * Agent uses Read and Grep tools across multiple turns.
 * Live-mode only — requires real provider for tool dispatch.
 */

import type { Pact } from '@methodts/pacta';

export const METHOD_ID = 'multi-turn-with-tools';

export const pact: Pact = {
  mode: { type: 'oneshot' },
  scope: { allowedTools: ['Read', 'Grep'] },
  budget: { maxTurns: 5, maxCostUsd: 0.10 },
};

export const prompt = `Read the file package.json in the current directory and tell me the project name. Use the Read tool.`;
