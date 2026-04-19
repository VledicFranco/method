// SPDX-License-Identifier: Apache-2.0
/**
 * MCP formatters — render fca-index port results to text for MCP tool responses.
 *
 * These are pure functions: port result → string. No side effects, no ports,
 * no transport concerns. They define what the agent actually reads after calling
 * context_query, context_detail, or coverage_check.
 *
 * Originally lived in @methodts/mcp/src/context-tools.ts. Moved here so the
 * standalone fca-index MCP server doesn't depend on @methodts/mcp.
 * @methodts/mcp keeps its copy for backward compat.
 *
 * Per-rank render caps (PRD 053 SC-1 — council 2026-04-12):
 *   Top-1 result gets up to ~350 chars per part (capped at 1400 total) with
 *   multi-line | prefix. Other results stay at ~120 chars single-line > prefix.
 */

import type { ContextQueryResult, FcaPart } from '../ports/context-query.js';
import type { CoverageReport } from '../ports/coverage-report.js';
import type { ComponentDetail } from '../ports/component-detail.js';

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_EXCERPT_RENDER_LIMIT = 350;
const TOP_TOTAL_RENDER_LIMIT = 1400;
const REST_EXCERPT_RENDER_LIMIT = 120;

// ── context_query formatter ──────────────────────────────────────────────────

export function formatContextQueryResult(
  result: ContextQueryResult,
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

// ── coverage_check formatter ─────────────────────────────────────────────────

export function formatCoverageReport(report: CoverageReport): string {
  const { summary } = report;
  const bar = (v: number) => '█'.repeat(Math.round(v * 20)).padEnd(20, '░');

  const lines: string[] = [
    `[mode: ${report.mode}]`,
    `Coverage: ${summary.overallScore.toFixed(2)} / threshold ${summary.threshold.toFixed(2)}  ${summary.meetsThreshold ? '✓' : '✗'}`,
    '',
    'By part:',
  ];

  const PARTS: FcaPart[] = [
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

// ── context_detail formatter ─────────────────────────────────────────────────

export function formatComponentDetail(detail: ComponentDetail): string {
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
