// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot loader — reads a projection snapshot file from disk and validates it.
 *
 * Returns null if the file does not exist. Logs a warning and returns null if the
 * file exists but is corrupt (unparseable JSON, wrong version, shape mismatch, or
 * domain mismatch). Corrupt snapshots are treated as "no snapshot" so the
 * ProjectionStore replays the full event log to rebuild state.
 *
 * @see .method/sessions/fcd-plan-20260405-1400-persistence-projections/realize-plan.md
 */

import type { FileSystemProvider } from '../../ports/file-system.js';
import type { ProjectionSnapshot } from '../persistence/types.js';

export interface LoadSnapshotOptions {
  fs: FileSystemProvider;
  /** Absolute path to the snapshot file (e.g. `.method/projections/build.json`). */
  path: string;
  /** Domain name expected inside the snapshot — used to detect mismatches. */
  expectedDomain: string;
  /** Optional logger override — defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Load and validate a ProjectionSnapshot from disk.
 * Returns null when:
 *   - the file does not exist (first boot or never snapshotted)
 *   - the file is not valid JSON
 *   - the parsed payload fails shape/version/domain validation
 */
export async function loadSnapshot(
  options: LoadSnapshotOptions,
): Promise<ProjectionSnapshot | null> {
  const { fs, path, expectedDomain } = options;
  const warn = options.warn ?? ((msg: string) => console.warn(msg));

  // Missing file is the normal first-boot case — not an error.
  try {
    await fs.access(path);
  } catch {
    return null;
  }

  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    warn(
      `[projection-store] failed to read snapshot at ${path}: ${(err as Error).message}. ` +
        `Treating as missing — will replay from sequence 0.`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn(
      `[projection-store] corrupt snapshot at ${path} (invalid JSON: ${(err as Error).message}). ` +
        `Discarding — will replay from sequence 0.`,
    );
    return null;
  }

  const validation = validateSnapshot(parsed, expectedDomain);
  if (!validation.ok) {
    warn(
      `[projection-store] corrupt snapshot at ${path} (${validation.reason}). ` +
        `Discarding — will replay from sequence 0.`,
    );
    return null;
  }

  return validation.value;
}

// ── Internal validation ─────────────────────────────────────────

type ValidationResult =
  | { ok: true; value: ProjectionSnapshot }
  | { ok: false; reason: string };

function validateSnapshot(
  candidate: unknown,
  expectedDomain: string,
): ValidationResult {
  if (candidate === null || typeof candidate !== 'object') {
    return { ok: false, reason: 'payload is not an object' };
  }

  const obj = candidate as Record<string, unknown>;

  if (obj.version !== 1) {
    return {
      ok: false,
      reason: `unsupported version ${String(obj.version)} (expected 1)`,
    };
  }

  if (typeof obj.domain !== 'string') {
    return { ok: false, reason: 'missing or non-string domain' };
  }

  if (obj.domain !== expectedDomain) {
    return {
      ok: false,
      reason: `domain mismatch: snapshot has '${obj.domain}', expected '${expectedDomain}'`,
    };
  }

  if (typeof obj.cursor !== 'number' || !Number.isFinite(obj.cursor) || obj.cursor < 0) {
    return { ok: false, reason: 'invalid cursor' };
  }

  if (typeof obj.eventCount !== 'number' || !Number.isFinite(obj.eventCount) || obj.eventCount < 0) {
    return { ok: false, reason: 'invalid eventCount' };
  }

  if (typeof obj.writtenAt !== 'string') {
    return { ok: false, reason: 'missing or non-string writtenAt' };
  }

  if (typeof obj.state !== 'string') {
    return { ok: false, reason: 'missing or non-string state' };
  }

  return {
    ok: true,
    value: {
      version: 1,
      domain: obj.domain,
      cursor: obj.cursor,
      eventCount: obj.eventCount,
      writtenAt: obj.writtenAt,
      state: obj.state,
    },
  };
}
