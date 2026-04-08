/**
 * Sample FCA L2 Domain — public interface.
 */

export interface SampleResult {
  id: string;
  value: string;
}

export interface SampleDomain {
  process(input: string): Promise<SampleResult>;
}

export function createSampleDomain(): SampleDomain {
  return {
    async process(input: string): Promise<SampleResult> {
      return { id: '1', value: input };
    },
  };
}
