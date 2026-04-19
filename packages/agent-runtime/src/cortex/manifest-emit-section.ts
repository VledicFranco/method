// SPDX-License-Identifier: Apache-2.0
/**
 * generate-manifest-emit-section — tenant-app build helper.
 *
 * PRD-063 §Scope item 7, S6 §5.3. The tenant app's `cortex-app.yaml`
 * must declare every topic it emits under `requires.events.emit[]`.
 * This generator produces those entries from the shipped
 * METHOD_TOPIC_REGISTRY so the manifest never drifts from the code.
 *
 * Usage:
 *   1. Programmatic:
 *        const entries = generateManifestEmitSection();
 *        const yaml = emitEntriesToYaml(entries);  // see below
 *   2. CLI (tenant-app build script):
 *        node -e "require('@methodts/agent-runtime/cortex/manifest-emit-section')\
 *                 .cliMain(process.argv)"
 *
 * The YAML emitter is deliberately minimal — it does not depend on
 * `js-yaml` (no new runtime dep). For richer transforms tenant apps can
 * feed the JSON output into their own yaml pipeline.
 */

import {
  METHOD_TOPIC_REGISTRY,
} from './event-topic-registry.js';
import type {
  MethodTopicDescriptor,
  EventFieldClassification,
} from './ctx-types.js';

// ── Public types ─────────────────────────────────────────────────

export interface ManifestEmitClassification {
  readonly field: string;
  readonly level: number;
}

export interface ManifestEmitEntry {
  readonly type: string;
  readonly schema: string;
  readonly classifications: readonly ManifestEmitClassification[];
  readonly description?: string;
  readonly schemaVersion: number;
}

export interface ManifestEmitOptions {
  /**
   * Filter to a subset of topics (intersection with the registry).
   * Omit to include all 21.
   */
  readonly topics?: ReadonlySet<string>;
  /**
   * How the tenant app references shipped schemas.
   *  - 'node_modules' (default): resolve via node_modules/@methodts/agent-runtime/
   *  - 'copied': the tenant app vendors schemas locally. Use `copiedSchemaPrefix`
   *    (default './schemas/method/') to customise the path.
   */
  readonly schemaRefMode?: 'node_modules' | 'copied';
  /** Relative prefix for 'copied' mode. Default './schemas/method/'. */
  readonly copiedSchemaPrefix?: string;
  /** Override the node_modules base path (rarely used). */
  readonly nodeModulesPrefix?: string;
}

// ── Core API ─────────────────────────────────────────────────────

const DEFAULT_NODE_MODULES_PREFIX =
  './node_modules/@methodts/agent-runtime/dist/cortex/';
const DEFAULT_COPIED_PREFIX = './schemas/method/';

export function generateManifestEmitSection(
  registry: readonly MethodTopicDescriptor[] = METHOD_TOPIC_REGISTRY,
  options: ManifestEmitOptions = {},
): ManifestEmitEntry[] {
  const mode = options.schemaRefMode ?? 'node_modules';
  const copiedPrefix = options.copiedSchemaPrefix ?? DEFAULT_COPIED_PREFIX;
  const nodeModulesPrefix =
    options.nodeModulesPrefix ?? DEFAULT_NODE_MODULES_PREFIX;

  const selection = options.topics
    ? registry.filter((d) => options.topics!.has(d.topic))
    : registry;

  return selection.map((desc) => ({
    type: desc.topic,
    schema: resolveSchemaRef(desc, mode, copiedPrefix, nodeModulesPrefix),
    classifications: desc.classifications.map(
      (c: EventFieldClassification): ManifestEmitClassification => ({
        field: c.field,
        level: c.level,
      }),
    ),
    description: desc.description,
    schemaVersion: desc.schemaVersion,
  }));
}

function resolveSchemaRef(
  desc: MethodTopicDescriptor,
  mode: 'node_modules' | 'copied',
  copiedPrefix: string,
  nodeModulesPrefix: string,
): string {
  // schemaRef on the descriptor is relative to
  // `packages/agent-runtime/dist/cortex/` — strip the leading './'
  // and prefix per mode.
  const raw = desc.schemaRef ?? `./schemas/method/${desc.topic.replace(/\./g, '-')}.schema.json`;
  const relative = raw.replace(/^\.\/?/, '');
  if (mode === 'copied') {
    // When the tenant vendors schemas, drop the shipped
    // `schemas/method/` prefix and reuse the filename.
    const fileName = relative.startsWith('schemas/method/')
      ? relative.slice('schemas/method/'.length)
      : relative;
    return `${copiedPrefix}${fileName}`;
  }
  return `${nodeModulesPrefix}${relative}`;
}

// ── YAML emitter (minimal, dep-free) ─────────────────────────────

/**
 * Emit the generator's output as a YAML block suitable for pasting
 * under `requires.events.emit:` in cortex-app.yaml.
 *
 * Intentionally minimal — escapes are conservative (uses a double-quoted
 * scalar whenever the string contains any non-trivial character). This
 * produces verbose but unambiguous output.
 */
export function emitEntriesToYaml(entries: readonly ManifestEmitEntry[]): string {
  if (entries.length === 0) return 'emit: []\n';
  const lines: string[] = ['emit:'];
  for (const entry of entries) {
    lines.push(`  - type: ${quote(entry.type)}`);
    lines.push(`    schemaVersion: ${entry.schemaVersion}`);
    lines.push(`    schema: ${quote(entry.schema)}`);
    if (entry.description !== undefined) {
      lines.push(`    description: ${quote(entry.description)}`);
    }
    if (entry.classifications.length === 0) {
      lines.push(`    classifications: []`);
    } else {
      lines.push(`    classifications:`);
      for (const c of entry.classifications) {
        lines.push(`      - field: ${quote(c.field)}`);
        lines.push(`        level: ${c.level}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function quote(s: string): string {
  // Use double-quoted string for safety; escape backslash and dquote.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ── CLI ──────────────────────────────────────────────────────────

/**
 * CLI entry. Invoked as:
 *   node -e "require('@methodts/agent-runtime/...').cliMain(process.argv)" \
 *     -- --format=yaml --mode=node_modules
 *
 * Accepted flags:
 *   --format=yaml|json       (default yaml)
 *   --mode=node_modules|copied  (default node_modules)
 *   --prefix=./custom/       (copied-mode prefix)
 *   --topics=a,b,c           (subset of topics)
 */
export function cliMain(argv: readonly string[]): string {
  const args = argv.slice(2);
  let format: 'yaml' | 'json' = 'yaml';
  let mode: 'node_modules' | 'copied' = 'node_modules';
  let prefix: string | undefined;
  let topics: Set<string> | undefined;

  for (const raw of args) {
    if (raw === '--help' || raw === '-h') {
      return helpText();
    }
    const m = raw.match(/^--(\w+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'format':
        if (value === 'json' || value === 'yaml') format = value;
        break;
      case 'mode':
        if (value === 'copied' || value === 'node_modules') mode = value;
        break;
      case 'prefix':
        prefix = value;
        break;
      case 'topics':
        topics = new Set(value.split(',').map((t) => t.trim()).filter(Boolean));
        break;
      default:
        break;
    }
  }

  const entries = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
    schemaRefMode: mode,
    copiedSchemaPrefix: prefix,
    topics,
  });

  return format === 'json' ? JSON.stringify(entries, null, 2) : emitEntriesToYaml(entries);
}

function helpText(): string {
  return `
generate-manifest-emit-section — produce cortex-app.yaml emit[] entries
from the method topic registry.

Usage:
  node -e "console.log(require('@methodts/agent-runtime/dist/cortex/manifest-emit-section').cliMain(process.argv))" -- [flags]

Flags:
  --format=yaml|json          Output format (default: yaml)
  --mode=node_modules|copied  Schema ref style (default: node_modules)
  --prefix=./path/            Copied-mode schema prefix (default: ./schemas/method/)
  --topics=a,b,c              Comma-separated subset of topics
  --help                      This message
`.trim();
}
