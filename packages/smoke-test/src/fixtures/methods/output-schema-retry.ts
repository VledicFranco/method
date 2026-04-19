// SPDX-License-Identifier: Apache-2.0
/**
 * Method fixture: output schema validation retry
 *
 * Agent must produce output matching a schema. First attempt returns
 * invalid output (mock), retry with feedback produces valid output.
 */

import type { Pact } from '@methodts/pacta';

export const METHOD_ID = 'output-schema-retry';

export interface ExpectedOutput {
  title: string;
  score: number;
  tags: string[];
}

export const pact: Pact = {
  mode: { type: 'oneshot' },
  output: {
    schema: {
      parse(raw: unknown) {
        if (typeof raw !== 'object' || raw === null) {
          return { success: false as const, errors: ['Expected object'] };
        }
        const obj = raw as Record<string, unknown>;
        if (typeof obj.title !== 'string') return { success: false as const, errors: ['Missing title string'] };
        if (typeof obj.score !== 'number') return { success: false as const, errors: ['Missing score number'] };
        if (!Array.isArray(obj.tags)) return { success: false as const, errors: ['Missing tags array'] };
        return { success: true as const, data: obj as unknown as ExpectedOutput };
      },
    },
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
};

export const prompt = `Return a JSON object with: title (string), score (number 0-100), tags (string array). Topic: "code quality".`;
