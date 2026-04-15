/**
 * O8 measurement harness — PRD-063 §Tests / N4 / S6 §8.1.
 *
 * Synthetic fixture corpus: for each of the 21 topics, generate plausible
 * payload sizes and record P50/P95/P99/max envelope bytes. Writes a JSON
 * report to `.method/retros/prd-063-envelope-sizes.json`.
 *
 * Opt-in — not part of the default `npm test` run. Invoke via:
 *   npx tsx packages/agent-runtime/src/cortex/envelope-sizes.measure.ts
 *
 * The harness answers the S6 open question O8: does
 * `method.strategy.gate.awaiting_approval` with realistic artifact_markdown
 * fit comfortably below the 256 KB SNS ceiling? Ceiling check fails if
 * P99 > 200 KB for any topic.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RuntimeEvent } from '@method/runtime/ports';

import {
  mapRuntimeEventToEnvelope,
  type EnvelopeMapperConfig,
} from './event-envelope-mapper.js';
import { METHOD_TOPIC_REGISTRY } from './event-topic-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// From packages/agent-runtime/src/cortex/ → repo root: 4 levels up.
// (cortex → src → agent-runtime → packages → repo-root).
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const REPORT_PATH = join(REPO_ROOT, '.method', 'retros', 'prd-063-envelope-sizes.json');

const APP_ID = 'method-runtime-o8';
const TRUNCATION_BYTES = 32 * 1024;
const SNS_LIMIT_BYTES = 256 * 1024;
const HEADROOM_P99_LIMIT = 200 * 1024;

function basePayloadFor(topic: string): Record<string, unknown> {
  // Representative payload shapes — chosen to exercise each topic's
  // heaviest expected field.
  switch (topic) {
    case 'method.strategy.gate.awaiting_approval':
      return { gate_id: 'g1', artifact_markdown: '', artifact_type: 'prd', timeout_ms: 60000 };
    case 'method.strategy.gate.approval_response':
      return { gate_id: 'g1', decision: 'approved', feedback: '' };
    case 'method.methodology.step_completed':
      return { step: 'exec', output: '' };
    case 'method.session.prompt.completed':
      return { promptPreview: '' };
    case 'method.tool.used':
      return { tool: 'bash', input: { cmd: 'echo' } };
    default:
      return {};
  }
}

/**
 * Generate a synthetic event with a payload augmented by an extra string
 * field of exact `extraBytes` size. For topics with a dominant markdown
 * field (gate.awaiting_approval, step_completed, prompt.completed), the
 * extra bytes go into that field; otherwise they go into a generic `body`.
 */
function syntheticEvent(
  topic: string,
  runtimeType: string,
  extraBytes: number,
): RuntimeEvent {
  const base = basePayloadFor(topic);
  const filler = 'x'.repeat(extraBytes);
  let payload: Record<string, unknown>;

  if (topic === 'method.strategy.gate.awaiting_approval') {
    payload = { ...base, artifact_markdown: filler };
  } else if (topic === 'method.methodology.step_completed') {
    payload = { ...base, output: filler };
  } else if (topic === 'method.session.prompt.completed') {
    payload = { ...base, promptPreview: filler };
  } else {
    payload = { ...base, body: filler };
  }

  return {
    id: `evt-${runtimeType}-${extraBytes}-${Math.random().toString(36).slice(2, 6)}`,
    version: 1,
    timestamp: '2026-04-15T00:00:00Z',
    sequence: 1,
    domain: topic.split('.')[1] as 'session',
    type: runtimeType,
    severity: 'info',
    payload,
    source: 'o8-harness',
  };
}

interface TopicStats {
  readonly topic: string;
  readonly count: number;
  readonly p50_bytes: number;
  readonly p95_bytes: number;
  readonly p99_bytes: number;
  readonly max_bytes: number;
  readonly truncated_count: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[rank];
}

export interface EnvelopeSizeReport {
  readonly date: string;
  readonly topics: readonly TopicStats[];
  readonly sns_limit_bytes: number;
  readonly truncation_threshold_bytes: number;
  readonly max_envelope_bytes: number;
  readonly headroom_ratio: number;
  readonly pass: boolean;
  readonly failing_topics: readonly string[];
}

export function runMeasurement(): EnvelopeSizeReport {
  const mapperCfg: EnvelopeMapperConfig = {
    appId: APP_ID,
    truncationThresholdBytes: TRUNCATION_BYTES,
  };

  // Size profile — exercise small, medium, large, very large per topic.
  // 50 KB + 100 KB cases verify truncation; others verify natural size.
  const sizes = [1, 512, 4 * 1024, 16 * 1024, 50 * 1024, 100 * 1024];
  const perSize = 20;

  const stats: TopicStats[] = [];
  let globalMax = 0;

  for (const desc of METHOD_TOPIC_REGISTRY) {
    const sizesObserved: number[] = [];
    let truncatedCount = 0;
    for (const sz of sizes) {
      for (let i = 0; i < perSize; i++) {
        const sourceType = desc.sourceEventTypes[i % desc.sourceEventTypes.length];
        const e = syntheticEvent(desc.topic, sourceType, sz);
        const outcome = mapRuntimeEventToEnvelope(e, mapperCfg);
        if (outcome.kind !== 'envelope') continue;
        const bytes = Buffer.byteLength(
          JSON.stringify(outcome.result.envelope),
          'utf8',
        );
        sizesObserved.push(bytes);
        if ((outcome.result.envelope.payload as { body_truncated?: boolean; artifact_markdown_truncated?: boolean; output_truncated?: boolean; prompt_truncated?: boolean })
          .artifact_markdown_truncated || (outcome.result.envelope.payload as { output_truncated?: boolean }).output_truncated || (outcome.result.envelope.payload as { prompt_truncated?: boolean }).prompt_truncated) {
          truncatedCount += 1;
        }
        globalMax = Math.max(globalMax, bytes);
      }
    }
    sizesObserved.sort((a, b) => a - b);
    stats.push({
      topic: desc.topic,
      count: sizesObserved.length,
      p50_bytes: percentile(sizesObserved, 50),
      p95_bytes: percentile(sizesObserved, 95),
      p99_bytes: percentile(sizesObserved, 99),
      max_bytes: sizesObserved[sizesObserved.length - 1] ?? 0,
      truncated_count: truncatedCount,
    });
  }

  const failing = stats.filter((s) => s.p99_bytes > HEADROOM_P99_LIMIT).map((s) => s.topic);
  const headroom = globalMax === 0 ? 1 : (SNS_LIMIT_BYTES - globalMax) / SNS_LIMIT_BYTES;

  return {
    date: new Date().toISOString().slice(0, 10),
    topics: stats,
    sns_limit_bytes: SNS_LIMIT_BYTES,
    truncation_threshold_bytes: TRUNCATION_BYTES,
    max_envelope_bytes: globalMax,
    headroom_ratio: headroom,
    pass: failing.length === 0,
    failing_topics: failing,
  };
}

export function writeReport(report: EnvelopeSizeReport, path: string = REPORT_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');
}

// Entry point when invoked as a script
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const report = runMeasurement();
  writeReport(report);
  // eslint-disable-next-line no-console
  console.log(
    `[o8] wrote ${REPORT_PATH}: max=${report.max_envelope_bytes}B, ` +
      `pass=${report.pass}, failing=${report.failing_topics.length}`,
  );
  if (!report.pass) process.exitCode = 1;
}
