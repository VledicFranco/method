// SPDX-License-Identifier: Apache-2.0
/**
 * Method fixture: analyse → critique → propose
 *
 * 3-step code analysis method. Each step is a separate agent invocation
 * with data flowing through an accumulating bundle.
 */

import type { Pact } from '@methodts/pacta';

export const METHOD_ID = 'analyse-critique-propose';

export interface StepDef {
  name: string;
  description: string;
  outputKey: string;
  inputKeys: string[];
  buildPrompt: (bundle: Record<string, string>) => string;
  pact: Pact;
}

export const initialBundle = {
  code: `function divide(a, b) {
  return a / b;
}
const result = divide(10, 0);
console.log("Result:", result);`,
};

export const steps: StepDef[] = [
  {
    name: 'analyse',
    description: 'Summarise what the code does',
    outputKey: 'summary',
    inputKeys: ['code'],
    pact: { mode: { type: 'oneshot' } },
    buildPrompt: (b) =>
      `You are a code reviewer. In 2 sentences, describe what this code does.\n\n\`\`\`\n${b.code}\n\`\`\`\n\nRespond with the summary only.`,
  },
  {
    name: 'critique',
    description: 'Identify the single most impactful issue',
    outputKey: 'issue',
    inputKeys: ['code', 'summary'],
    pact: { mode: { type: 'oneshot' } },
    buildPrompt: (b) =>
      `Given the code and summary, identify the SINGLE most impactful issue. One paragraph.\n\nSummary: ${b.summary}\n\n\`\`\`\n${b.code}\n\`\`\``,
  },
  {
    name: 'propose',
    description: 'Propose a concrete fix',
    outputKey: 'fix',
    inputKeys: ['code', 'issue'],
    pact: { mode: { type: 'oneshot' } },
    buildPrompt: (b) =>
      `Propose a concrete fix for the issue. Short code diff or 2-3 lines.\n\nIssue: ${b.issue}\n\n\`\`\`\n${b.code}\n\`\`\``,
  },
];
