/**
 * Context tools — MCP wrappers over @method/fca-index ports.
 *
 * DR-04 compliance: parse input → call port → format output. No business logic.
 * Both handlers follow the same structure as bridge-tools.ts and experiment-tools.ts.
 */
import type {
  ContextQueryPort,
  CoverageReportPort,
  ComponentDetailPort,
  FcaPart,
  FcaLevel,
} from '@method/fca-index';
import { ComponentDetailError } from '@method/fca-index';

// ── Tool definitions ─────────────────────────────────────────────────────────

export const CONTEXT_TOOLS = [
  {
    name: 'context_query',
    description:
      'Query the FCA index of a project for components relevant to a task or concept. ' +
      'Returns ranked component descriptors (paths, part excerpts, relevance scores) for ' +
      'efficient context gathering — reads far fewer tokens than filesystem search. ' +
      'The top result is rendered with expanded excerpts so you can usually act on it ' +
      'without reading source files. For full implementation details on any result, ' +
      'call context_detail — it is cheaper than opening the source file.',
    inputSchema: {
      type: 'object' as const,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language description of the code or concept you need',
        },
        topK: {
          type: 'number',
          description: 'Max results (default 5)',
          default: 5,
        },
        parts: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter to specific FCA parts: interface, port, domain, verification, ' +
            'observability, documentation, architecture, boundary',
        },
        levels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific FCA levels: L0, L1, L2, L3, L4, L5',
        },
        minCoverageScore: {
          type: 'number',
          description: 'Exclude components with coverage below this score (0–1)',
        },
      },
    },
  },
  {
    name: 'context_detail',
    description:
      'Retrieve full detail for a single indexed component by its path. ' +
      'Returns all FCA parts (with file locations and excerpts), full docText, level, and indexedAt. ' +
      'Use after context_query to get the complete picture of a specific component — ' +
      'more precise than reading the source files directly.',
    inputSchema: {
      type: 'object' as const,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Component path relative to projectRoot (e.g., "src/domains/sessions")',
        },
        projectRoot: {
          type: 'string',
          description: 'Absolute path to the project root (defaults to METHOD_ROOT env var)',
        },
      },
    },
  },
  {
    name: 'coverage_check',
    description:
      'Check FCA documentation coverage for a project. Returns coverage summary and ' +
      'whether the index is in discovery or production mode. Use before context_query ' +
      'to understand index reliability.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: {
          type: 'string',
          description: 'Absolute path to the project root (defaults to METHOD_ROOT env var)',
        },
        verbose: {
          type: 'boolean',
          description: 'Include per-component breakdown (default false)',
          default: false,
        },
      },
    },
  },
];

// ── Factory ──────────────────────────────────────────────────────────────────

export function createContextTools(
  contextQuery: ContextQueryPort,
  coverageReport: CoverageReportPort,
  defaultProjectRoot: string,
  componentDetail?: ComponentDetailPort,
) {
  return {
    CONTEXT_TOOLS,
    contextQueryHandler,
    coverageCheckHandler,
    contextDetailHandler,
  };

  async function contextQueryHandler(args: Record<string, unknown>) {
    // Parse
    const query = String(args.query ?? '');
    const topK = typeof args.topK === 'number' ? args.topK : 5;
    const parts = Array.isArray(args.parts) ? (args.parts as FcaPart[]) : undefined;
    const levels = Array.isArray(args.levels) ? (args.levels as FcaLevel[]) : undefined;
    const minCoverageScore =
      typeof args.minCoverageScore === 'number' ? args.minCoverageScore : undefined;

    // Call port
    let result;
    try {
      result = await contextQuery.query({ query, topK, parts, levels, minCoverageScore });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('INDEX_NOT_FOUND') || msg.includes('No index found')) {
        return ok(
          `[error: INDEX_NOT_FOUND]\nRun 'fca-index scan <projectRoot>' to build the index.`,
        );
      }
      throw e;
    }

    // Format
    return ok(formatContextQueryResult(result, query));
  }

  async function coverageCheckHandler(args: Record<string, unknown>) {
    const projectRoot =
      typeof args.projectRoot === 'string' ? args.projectRoot : defaultProjectRoot;
    const verbose = args.verbose === true;

    let report;
    try {
      report = await coverageReport.getReport({ projectRoot, verbose });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('INDEX_NOT_FOUND') || msg.includes('No index found')) {
        return ok(
          `[error: INDEX_NOT_FOUND]\nRun 'fca-index scan <projectRoot>' to build the index.`,
        );
      }
      throw e;
    }

    return ok(formatCoverageReport(report));
  }

  async function contextDetailHandler(args: Record<string, unknown>) {
    if (!componentDetail) {
      return ok('[error: DETAIL_UNAVAILABLE]\ncontext_detail tool is not configured on this server.');
    }

    const path = typeof args.path === 'string' ? args.path : undefined;
    if (!path) {
      return ok('[error: INVALID_INPUT]\nRequired parameter "path" is missing or not a string.');
    }
    const projectRoot =
      typeof args.projectRoot === 'string' ? args.projectRoot : defaultProjectRoot;

    let detail;
    try {
      detail = await componentDetail.getDetail({ path, projectRoot });
    } catch (e: unknown) {
      if (e instanceof ComponentDetailError) {
        if (e.code === 'INDEX_NOT_FOUND') {
          return ok(
            `[error: INDEX_NOT_FOUND]\nRun 'fca-index scan <projectRoot>' to build the index.`,
          );
        }
        if (e.code === 'NOT_FOUND') {
          return ok(`[error: NOT_FOUND]\n${e.message}`);
        }
      }
      throw e;
    }

    return ok(formatComponentDetail(detail));
  }
}

// ── Formatters ───────────────────────────────────────────────────────────────

// Per-rank render caps. The producer (fca-index ResultFormatter) already trims
// excerpts per-rank using identical bounds; these constants are defensive caps
// at the rendering boundary so the MCP layer never emits more than expected.
// PRD 053 SC-1 — council 2026-04-12.
const TOP_EXCERPT_RENDER_LIMIT = 350;
const TOP_TOTAL_RENDER_LIMIT = 1400;
const REST_EXCERPT_RENDER_LIMIT = 120;

function formatContextQueryResult(
  result: import('@method/fca-index').ContextQueryResult,
  query: string,
): string {
  const lines: string[] = [
    `[mode: ${result.mode}]`,
    `[${result.results.length} results for "${query}"]`,
    '',
  ];
  for (let i = 0; i < result.results.length; i++) {
    const c = result.results[i];
    const isTop = i === 0;
    lines.push(
      `${i + 1}. ${c.path} (${c.level}) — relevance: ${c.relevanceScore.toFixed(2)}, coverage: ${c.coverageScore.toFixed(2)}`,
    );

    let topUsed = 0;
    for (const p of c.parts) {
      lines.push(`   ${p.part}: ${p.filePath}`);
      if (!p.excerpt) continue;

      if (isTop) {
        const remaining = TOP_TOTAL_RENDER_LIMIT - topUsed;
        if (remaining <= 0) continue;
        const limit = Math.min(TOP_EXCERPT_RENDER_LIMIT, remaining);
        const excerpt = p.excerpt.slice(0, limit);
        // Multi-line | prefix preserves structure for the top result.
        const indented = excerpt
          .split('\n')
          .map((l) => `     | ${l}`)
          .join('\n');
        lines.push(indented);
        topUsed += excerpt.length;
      } else {
        const excerpt = p.excerpt.slice(0, REST_EXCERPT_RENDER_LIMIT).replace(/\n/g, ' ');
        lines.push(`     > ${excerpt}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatCoverageReport(
  report: import('@method/fca-index').CoverageReport,
): string {
  const { summary } = report;
  const bar = (v: number) => '█'.repeat(Math.round(v * 20)).padEnd(20, '░');

  const lines: string[] = [
    `[mode: ${report.mode}]`,
    `Coverage: ${summary.overallScore.toFixed(2)} / threshold ${summary.threshold.toFixed(2)}  ${summary.meetsThreshold ? '✓' : '✗'}`,
    '',
    'By part:',
  ];

  const PARTS: Array<import('@method/fca-index').FcaPart> = [
    'documentation', 'interface', 'port', 'verification',
    'observability', 'architecture', 'domain', 'boundary',
  ];
  for (const part of PARTS) {
    const v = summary.byPart[part] ?? 0;
    lines.push(`  ${part.padEnd(16)} ${v.toFixed(2)} ${bar(v)}`);
  }

  lines.push('');
  lines.push(
    `Components: ${summary.totalComponents} total | ${summary.fullyDocumented} fully documented | ${summary.partiallyDocumented} partial | ${summary.undocumented} undocumented`,
  );

  return lines.join('\n');
}

function formatComponentDetail(
  detail: import('@method/fca-index').ComponentDetail,
): string {
  const lines: string[] = [
    `path: ${detail.path}`,
    `level: ${detail.level}`,
    `indexedAt: ${detail.indexedAt}`,
    '',
    'parts:',
  ];

  for (const p of detail.parts) {
    lines.push(`  ${p.part}: ${p.filePath}`);
    if (p.excerpt) {
      const excerpt = p.excerpt.slice(0, 300).replace(/\n/g, '\n    ');
      lines.push(`    > ${excerpt}`);
    }
  }

  if (detail.docText) {
    lines.push('');
    lines.push('docText:');
    const truncated =
      detail.docText.length > 2000
        ? detail.docText.slice(0, 2000) + '\n... (truncated)'
        : detail.docText;
    lines.push(truncated);
  }

  return lines.join('\n').trimEnd();
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
