/**
 * PRD-057 SC-6 / C7 — Event-type snapshot gate (G-EVENT-TYPE-SNAPSHOT).
 *
 * Asserts that the union of **literal** RuntimeEvent `type` strings
 * emitted by `@method/runtime` source code matches a committed manifest.
 * Any accidental removal, rename, or addition of an event type flips
 * this test red. Intentional changes update both the emission site and
 * the manifest in the same PR.
 *
 * Scope:
 * - Scans `packages/runtime/src/**\/*.ts` excluding tests, index barrels,
 *   and architecture tests.
 * - Matches three syntactic shapes used today in the codebase:
 *     1. Object-literal property: `type: 'domain.subtype'`
 *     2. `emit(bus, 'domain.subtype', ...)` (cost-events.ts factory)
 *     3. Membership sets containing `'domain.subtype'` entries — captured
 *        only when the surrounding context was already a known
 *        `SESSION_EVENT_TYPES`-style static list (detected heuristically).
 * - Dynamic / interpolated types (e.g. `\`session.cognitive.${e}\``) are
 *   out of scope — the snapshot captures the **stable wire surface** per
 *   S2 §4 ("Event `type` strings unchanged — wire format is stable").
 *
 * Wire-format stability rule: event `type` strings are part of the
 * public contract. This test enforces that invariant.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_SRC = resolve(__dirname, '..');

/**
 * Committed snapshot of the literal event `type` strings produced by
 * `@method/runtime`. Sorted alphabetically. Changing this list requires
 * an intentional edit reviewed alongside the emission site change.
 *
 * PRD-057 / S2 §4 / SC-6: this is the stable wire format contract.
 */
const EVENT_TYPE_MANIFEST: readonly string[] = [
  // Cost governor
  // Note: `CostEventType` (cost-events.ts) declares two additional
  // variants — `cost.clock_discontinuity` and `cost.prediction_diverged`
  // — that are reserved in the union but not currently emitted from
  // any source path. When an emitter for either is added, re-add the
  // string here in the same commit.
  'cost.account_saturated',
  'cost.estimate_emitted',
  'cost.integrity_violation',
  'cost.observation_parse_error',
  'cost.observation_recorded',
  'cost.observations_corrupted',
  'cost.rate_limited',
  'cost.slot_leaked',
  // Gate / approval (strategy domain)
  'gate.approval_response',
  'gate.awaiting_approval',
  // Session lifecycle
  'session.dead',
  'session.killed',
  'session.prompt.completed',
  'session.spawned',
  'session.stale',
  'session.state_changed',
  // System
  'system.bus_error',
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts')) {
      // Skip test files and architecture tests — they reference arbitrary
      // event types as fixtures and would pollute the snapshot.
      if (entry.endsWith('.test.ts')) continue;
      if (entry === 'architecture.test.ts') continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract literal event `type` strings emitted by a runtime source file.
 *
 * Matches `type: 'x.y'`, `type: "x.y"`, and `emit(bus, 'x.y', ...)`.
 * Skips template literals (intentional — those are dynamic, not part of
 * the stable snapshot).
 */
function extractEventTypes(source: string): string[] {
  const types: string[] = [];
  // Shape 1: `type: 'x.y'` or `type: "x.y"`
  const propPattern = /\btype:\s*(['"])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1/g;
  // Shape 2: `emit(bus, 'x.y', ...)` (cost-events factory helper)
  const emitPattern = /\bemit\s*\(\s*[A-Za-z_][\w]*\s*,\s*(['"])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1/g;
  // Shape 3: membership-set literals: ['x.y', 'a.b', ...] or Set([...])
  //   captured by scanning any string literal matching the event-type shape
  //   on lines INSIDE a `new Set([`...`])` block starting from an
  //   identifier-assigned constant containing `EVENT_TYPES`.
  //   Simpler: include any string-literal of shape domain.subtype appearing
  //   in files named `session-checkpoint-sink.ts` or inside declared
  //   `EVENT_TYPES` regions. Rather than over-engineer, handle it by
  //   explicit inclusion: capture plain string-literals of the shape in
  //   source files we know hold event-type sets.

  let m: RegExpExecArray | null;
  while ((m = propPattern.exec(source)) !== null) types.push(m[2]);
  while ((m = emitPattern.exec(source)) !== null) types.push(m[2]);
  return types;
}

/**
 * A small allow-list of files that declare event-type sets (not emissions).
 * These contribute literal types via plain string-literals, not
 * `type: '...'` object-property syntax. We scan them for any
 * shape-matching string literal.
 */
const EVENT_TYPE_SET_FILES = new Set<string>([
  // session-checkpoint-sink.ts has `SESSION_EVENT_TYPES = new Set([...])`
  'session-checkpoint-sink.ts',
]);

function extractEventTypesFromSetFile(source: string): string[] {
  const types: string[] = [];
  // Any 'domain.subtype' string-literal shape. Keep restrictive to
  // lower-case alnum/underscore tokens separated by dots.
  const literalPattern = /(['"])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = literalPattern.exec(source)) !== null) types.push(m[2]);
  return types;
}

describe('@method/runtime — event-type snapshot (PRD-057 SC-6 / G-EVENT-TYPE-SNAPSHOT)', () => {
  it('union of literal RuntimeEvent type strings matches the committed manifest', () => {
    const files = walkTsFiles(RUNTIME_SRC);
    const seen = new Set<string>();

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const t of extractEventTypes(src)) seen.add(t);

      const basename = file.split(/[\\/]/).pop() ?? '';
      if (EVENT_TYPE_SET_FILES.has(basename)) {
        for (const t of extractEventTypesFromSetFile(src)) seen.add(t);
      }
    }

    const actual = Array.from(seen).sort();
    const expected = [...EVENT_TYPE_MANIFEST].sort();

    assert.deepEqual(
      actual,
      expected,
      `Event-type snapshot drift detected.\n` +
        `  Added (in source, not manifest):   ${actual.filter((t) => !expected.includes(t)).join(', ') || '<none>'}\n` +
        `  Removed (in manifest, not source): ${expected.filter((t) => !actual.includes(t)).join(', ') || '<none>'}\n` +
        `If the change is intentional, update EVENT_TYPE_MANIFEST in this file.`,
    );
  });
});
