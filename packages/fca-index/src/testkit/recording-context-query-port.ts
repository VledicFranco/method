// SPDX-License-Identifier: Apache-2.0
/**
 * RecordingContextQueryPort — Test double for ContextQueryPort.
 *
 * Records all calls for assertion, returns configurable stub results.
 * Use in @methodts/mcp tests that consume ContextQueryPort.
 *
 * Part of @methodts/fca-index/testkit — not included in production bundle.
 */

import type { ContextQueryPort, ContextQueryRequest, ContextQueryResult, ComponentContext } from '../ports/context-query.js';

export class RecordingContextQueryPort implements ContextQueryPort {
  readonly calls: ContextQueryRequest[] = [];

  private readonly stubResults: ComponentContext[];
  private readonly stubMode: 'discovery' | 'production';

  constructor(options: { results?: ComponentContext[]; mode?: 'discovery' | 'production' } = {}) {
    this.stubResults = options.results ?? [];
    this.stubMode = options.mode ?? 'discovery';
  }

  async query(request: ContextQueryRequest): Promise<ContextQueryResult> {
    this.calls.push(request);
    const topK = request.topK ?? 5;
    return {
      mode: this.stubMode,
      results: this.stubResults.slice(0, topK),
    };
  }

  /** Assert the port was called exactly N times. */
  assertCallCount(n: number): void {
    if (this.calls.length !== n) {
      throw new Error(`Expected ${n} calls to ContextQueryPort.query, got ${this.calls.length}`);
    }
  }

  /** Assert the last call used the given query string. */
  assertLastQuery(query: string): void {
    const last = this.calls[this.calls.length - 1];
    if (!last || last.query !== query) {
      throw new Error(`Expected last query to be "${query}", got "${last?.query}"`);
    }
  }
}
