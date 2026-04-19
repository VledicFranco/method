// SPDX-License-Identifier: Apache-2.0
/**
 * ContextLoadExecutorImpl — runtime implementation of the ContextLoadExecutor port.
 *
 * Implements the co-designed surface between methodts (DagStrategyExecutor) and
 * @methodts/fca-index. Adapts ContextQueryPort → ContextLoadExecutor, mapping
 * ComponentContext → RetrievedComponent.
 *
 * Layer: L3 (runtime) — correctly imports both @methodts/methodts (L2) and
 * @methodts/fca-index (L3 sibling). Neither lower layer knows about the other.
 *
 * Co-design record: .method/sessions/fcd-surface-context-load-executor/record.md
 *
 * PRD-057 / S2 §3.2 / C2: moved from @methodts/bridge/domains/strategies/.
 */

import type {
  ContextLoadExecutor,
  ContextLoadResult,
  RetrievedComponent,
} from '@methodts/methodts/strategy/dag-executor.js';
import type { ContextLoadNodeConfig } from '@methodts/methodts/strategy/dag-types.js';
import { ContextLoadError } from '@methodts/methodts/strategy/dag-executor.js';
import type { ContextQueryPort, ComponentContext, FcaPart } from '@methodts/fca-index';
import { ContextQueryError } from '@methodts/fca-index';

export class ContextLoadExecutorImpl implements ContextLoadExecutor {
  constructor(private readonly queryPort: ContextQueryPort) {}

  async executeContextLoad(
    config: ContextLoadNodeConfig,
    projectRoot: string,
  ): Promise<ContextLoadResult> {
    const startMs = Date.now();

    let result;
    try {
      result = await this.queryPort.query({
        query: config.query,
        topK: config.topK,
        parts: config.filterParts as FcaPart[] | undefined,
      });
    } catch (err) {
      if (err instanceof ContextQueryError && err.code === 'INDEX_NOT_FOUND') {
        throw new ContextLoadError(
          `context-load: no index found for project '${projectRoot}'. Run 'fca-index scan' first.`,
          'INDEX_NOT_FOUND',
          config.output_key,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new ContextLoadError(
        `context-load: query failed — ${msg}`,
        'QUERY_FAILED',
        config.output_key,
      );
    }

    return {
      components: result.results.map(toRetrievedComponent),
      queryTime: Date.now() - startMs,
      mode: result.mode,
    };
  }
}

// ── Mapping ───────────────────────────────────────────────────────────────────

/**
 * Map ComponentContext → RetrievedComponent.
 *
 * docText is synthesised from part excerpts in priority order:
 * documentation (README) > interface (exports) > port (interfaces) > any other part.
 * This gives strategy templates the most human-readable context by default.
 */
function toRetrievedComponent(ctx: ComponentContext): RetrievedComponent {
  return {
    path: ctx.path,
    level: ctx.level,
    docText: buildDocText(ctx),
    coverageScore: ctx.coverageScore,
    score: ctx.relevanceScore,
  };
}

const EXCERPT_PRIORITY: FcaPart[] = [
  'documentation',
  'interface',
  'port',
  'domain',
  'architecture',
  'boundary',
  'verification',
  'observability',
];

function buildDocText(ctx: ComponentContext): string {
  const excerpts: string[] = [];

  for (const part of EXCERPT_PRIORITY) {
    const found = ctx.parts.find((p) => p.part === part);
    if (found?.excerpt) {
      excerpts.push(`[${part}]\n${found.excerpt}`);
    }
  }

  if (excerpts.length === 0) {
    return ctx.path; // fallback: path as minimal identifier
  }

  return excerpts.join('\n\n');
}
