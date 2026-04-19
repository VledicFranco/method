// SPDX-License-Identifier: Apache-2.0
/**
 * ObservationsStore — JSONL-backed HistoricalObservations implementation.
 *
 * Features:
 * - HMAC per line (integrity check on read)
 * - In-memory index by signature hash (cap 1000 per signature)
 * - AppendToken capability enforcement
 * - Crash recovery: skip invalid HMAC lines, rename wholly-corrupted files
 */

import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import type { InvocationSignature } from '@methodts/types';
import type { FileSystemProvider } from '../ports/file-system.js';
import type {
  HistoricalObservations,
  Observation,
  AppendToken,
} from '../ports/historical-observations.js';
import { signatureKey } from './signature-builder.js';

export interface ObservationsStoreConfig {
  /** Directory where JSONL files are stored. */
  dataDir: string;
  /** Secret key for HMAC integrity (boot-time generated). */
  hmacSecret: string;
  /** Max observations held in memory per signature. */
  maxPerSignature?: number;
}

export interface RecoveryResult {
  validLines: number;
  skippedLines: number;
  corruptedFile: boolean;
}

export interface DiagnosticEvent {
  type:
    | 'cost.integrity_violation'
    | 'cost.observations_corrupted'
    | 'cost.observation_parse_error';
  payload: Record<string, unknown>;
}

export class ObservationsStore implements HistoricalObservations {
  private index = new Map<string, Observation[]>();
  private readonly maxPerSignature: number;
  private readonly filePath: string;

  constructor(
    private readonly config: ObservationsStoreConfig,
    private readonly fs: FileSystemProvider,
    private readonly diagnostic?: (event: DiagnosticEvent) => void,
  ) {
    this.maxPerSignature = config.maxPerSignature ?? 1000;
    this.filePath = join(config.dataDir, currentMonthFilename());
  }

  /** Load observations from disk. Returns recovery stats. */
  recover(): RecoveryResult {
    if (!this.fs.existsSync(this.config.dataDir)) {
      this.fs.mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!this.fs.existsSync(this.filePath)) {
      return { validLines: 0, skippedLines: 0, corruptedFile: false };
    }

    let raw: string;
    try {
      raw = this.fs.readFileSync(this.filePath, 'utf-8');
    } catch {
      this.renameCorrupted();
      return { validLines: 0, skippedLines: 0, corruptedFile: true };
    }

    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    let validCount = 0;
    let skipCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const result = this.tryParseLine(line, i);
      if (result) {
        this.addToIndex(result);
        validCount++;
      } else {
        skipCount++;
      }
    }

    // If everything is bad, treat as total corruption
    if (lines.length > 0 && validCount === 0) {
      this.renameCorrupted();
      return {
        validLines: 0,
        skippedLines: skipCount,
        corruptedFile: true,
      };
    }

    return { validLines: validCount, skippedLines: skipCount, corruptedFile: false };
  }

  query(sig: InvocationSignature, limit?: number): readonly Observation[] {
    const key = signatureKey(sig);
    const arr = this.index.get(key) ?? [];
    // Newest first
    const reversed = [...arr].reverse();
    return limit !== undefined ? reversed.slice(0, limit) : reversed;
  }

  append(obs: Omit<Observation, 'hmac'>, _token: AppendToken): void {
    const serialized = JSON.stringify(obs);
    const hmac = this.computeHmac(serialized);
    const full: Observation = { ...obs, hmac };
    const line = JSON.stringify(full) + '\n';

    // Append to file (best-effort, sync)
    try {
      // Ensure dir exists
      if (!this.fs.existsSync(this.config.dataDir)) {
        this.fs.mkdirSync(this.config.dataDir, { recursive: true });
      }
      // Append by read+write (FileSystemProvider has appendFile only async)
      const existing = this.fs.existsSync(this.filePath)
        ? this.fs.readFileSync(this.filePath, 'utf-8')
        : '';
      this.fs.writeFileSync(this.filePath, existing + line, { encoding: 'utf-8' });
    } catch (err) {
      // Re-throw to caller — persistence failure is important
      throw new Error(`ObservationsStore append failed: ${(err as Error).message}`);
    }

    this.addToIndex(full);
  }

  /** Total observations held in memory across all signatures. */
  count(): number {
    let total = 0;
    for (const arr of this.index.values()) total += arr.length;
    return total;
  }

  private addToIndex(obs: Observation): void {
    const key = signatureKey(obs.signature);
    let arr = this.index.get(key);
    if (!arr) {
      arr = [];
      this.index.set(key, arr);
    }
    arr.push(obs);
    // Cap per-signature
    if (arr.length > this.maxPerSignature) {
      arr.shift();
    }
  }

  private tryParseLine(line: string, lineNumber: number): Observation | null {
    let parsed: Observation;
    try {
      parsed = JSON.parse(line) as Observation;
    } catch {
      this.diagnostic?.({
        type: 'cost.observation_parse_error',
        payload: { lineNumber, reason: 'invalid JSON' },
      });
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.hmac) {
      this.diagnostic?.({
        type: 'cost.integrity_violation',
        payload: { lineNumber, reason: 'missing hmac' },
      });
      return null;
    }

    // Verify HMAC
    const { hmac: providedHmac, ...rest } = parsed;
    const expected = this.computeHmac(JSON.stringify(rest));
    if (providedHmac !== expected) {
      this.diagnostic?.({
        type: 'cost.integrity_violation',
        payload: {
          lineNumber,
          reason: 'HMAC mismatch',
        },
      });
      return null;
    }

    return parsed;
  }

  private computeHmac(data: string): string {
    return createHmac('sha256', this.config.hmacSecret)
      .update(data)
      .digest('hex');
  }

  private renameCorrupted(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const corruptPath = `${this.filePath}.corrupt-${ts}`;
    try {
      this.fs.renameSync(this.filePath, corruptPath);
    } catch {
      // best effort
    }
    this.diagnostic?.({
      type: 'cost.observations_corrupted',
      payload: { renamedTo: corruptPath, recordsLoaded: 0, recordsSkipped: 0 },
    });
  }
}

function currentMonthFilename(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `observations-${year}-${month}.jsonl`;
}
