/**
 * Sample FCA L2 Domain — verification tests.
 */

import { describe, it, expect } from 'vitest';
import { createSampleDomain } from './index.js';

describe('SampleDomain', () => {
  it('processes input correctly', async () => {
    const domain = createSampleDomain();
    const result = await domain.process('hello');
    expect(result.value).toBe('hello');
  });
});
