/**
 * RecordingComponentDetailPort — Test double for ComponentDetailPort.
 *
 * Records calls and returns configurable stub responses.
 * Use in @method/mcp tests that consume ComponentDetailPort.
 *
 * Part of @method/fca-index/testkit — not included in production bundle.
 */

import type { ComponentDetailPort, ComponentDetailRequest, ComponentDetail } from '../ports/component-detail.js';
import { ComponentDetailError } from '../ports/component-detail.js';

const DEFAULT_DETAIL: ComponentDetail = {
  path: 'src/default',
  level: 'L2',
  parts: [
    { part: 'interface', filePath: 'src/default/index.ts', excerpt: 'Default interface excerpt.' },
    { part: 'documentation', filePath: 'src/default/README.md', excerpt: 'Default documentation.' },
  ],
  docText: 'Default interface excerpt.\n\nDefault documentation.',
  indexedAt: '2026-01-01T00:00:00.000Z',
};

export class RecordingComponentDetailPort implements ComponentDetailPort {
  readonly calls: ComponentDetailRequest[] = [];
  private readonly stubDetail: ComponentDetail;
  private readonly throwNotFound: boolean;

  constructor(options: { detail?: ComponentDetail; notFound?: boolean } = {}) {
    this.stubDetail = options.detail ?? DEFAULT_DETAIL;
    this.throwNotFound = options.notFound ?? false;
  }

  async getDetail(request: ComponentDetailRequest): Promise<ComponentDetail> {
    this.calls.push(request);
    if (this.throwNotFound) {
      throw new ComponentDetailError(
        `Component '${request.path}' not found in index.`,
        'NOT_FOUND',
      );
    }
    return { ...this.stubDetail, path: request.path };
  }

  assertCallCount(n: number): void {
    if (this.calls.length !== n) {
      throw new Error(
        `Expected ${n} calls to ComponentDetailPort.getDetail, got ${this.calls.length}`,
      );
    }
  }
}
