import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ObservationsStore } from './observations-store.js';
import { createAppendToken } from '../ports/historical-observations.js';
import type {
  FileSystemProvider,
  FileStat,
  DirEntry,
} from '../ports/file-system.js';
import type {
  InvocationSignature,
  AccountId,
} from '@method/types';

// In-memory FileSystemProvider mock
class MemFs implements FileSystemProvider {
  files = new Map<string, string>();
  dirs = new Set<string>();

  readFileSync(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }
  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(_path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    return options?.withFileTypes ? ([] as DirEntry[]) : ([] as string[]);
  }
  statSync(_path: string): FileStat {
    throw new Error('not implemented');
  }
  unlinkSync(path: string): void {
    this.files.delete(path);
  }
  mkdirSync(path: string): void {
    this.dirs.add(path);
  }
  renameSync(oldPath: string, newPath: string): void {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
  realpathSync(path: string): string { return path; }
  async readFile(path: string): Promise<string> { return this.readFileSync(path); }
  async writeFile(path: string, content: string): Promise<void> { this.writeFileSync(path, content); }
  async appendFile(path: string, content: string): Promise<void> {
    const existing = this.files.get(path) ?? '';
    this.files.set(path, existing + content);
  }
  async readdir(_path: string): Promise<string[]> { return []; }
  async stat(_path: string): Promise<FileStat> { throw new Error('not implemented'); }
  async access(_path: string): Promise<void> {}
  async mkdir(path: string): Promise<void> { this.dirs.add(path); }
}

const sig: InvocationSignature = {
  methodologyId: 'P2-SD',
  capabilities: ['write'],
  model: 'opus',
  inputSizeBucket: 's',
};

const makeObs = (costUsd: number) => ({
  signature: sig,
  costUsd,
  durationMs: 10_000,
  tokensIn: 100,
  tokensOut: 200,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  recordedAt: Date.now(),
  accountId: 'default' as AccountId,
  providerClass: 'claude-cli' as const,
});

describe('ObservationsStore — basic', () => {
  it('append then query round-trip', () => {
    const fs = new MemFs();
    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'test-secret' },
      fs,
    );
    store.recover();

    const token = createAppendToken();
    store.append(makeObs(0.10), token);
    store.append(makeObs(0.20), token);

    const results = store.query(sig);
    assert.equal(results.length, 2);
    // Newest first
    assert.equal(results[0].costUsd, 0.20);
    assert.equal(results[1].costUsd, 0.10);
  });

  it('query with limit', () => {
    const fs = new MemFs();
    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'test' },
      fs,
    );
    store.recover();

    const token = createAppendToken();
    for (let i = 0; i < 10; i++) store.append(makeObs(i * 0.01), token);

    const limited = store.query(sig, 3);
    assert.equal(limited.length, 3);
  });

  it('persists to file with HMAC', () => {
    const fs = new MemFs();
    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
    );
    store.recover();

    store.append(makeObs(0.15), createAppendToken());

    // Find the observations file
    const filePaths = [...fs.files.keys()];
    const jsonlPath = filePaths.find(p => p.includes('observations-'));
    assert.ok(jsonlPath);

    const content = fs.files.get(jsonlPath!)!;
    const line = content.trim();
    const parsed = JSON.parse(line);
    assert.ok(parsed.hmac);
    assert.equal(typeof parsed.hmac, 'string');
    assert.equal(parsed.hmac.length, 64); // sha256 hex
  });

  it('per-signature cap enforced', () => {
    const fs = new MemFs();
    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'test', maxPerSignature: 3 },
      fs,
    );
    store.recover();

    const token = createAppendToken();
    for (let i = 0; i < 5; i++) store.append(makeObs(i * 0.1), token);

    const all = store.query(sig);
    assert.equal(all.length, 3); // capped
  });
});

describe('ObservationsStore — integrity & recovery', () => {
  it('loads valid observations on restart', () => {
    const fs = new MemFs();
    // Write some observations
    const store1 = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
    );
    store1.recover();
    const token = createAppendToken();
    store1.append(makeObs(0.1), token);
    store1.append(makeObs(0.2), token);

    // New instance reads the same file
    const store2 = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
    );
    const result = store2.recover();
    assert.equal(result.validLines, 2);
    assert.equal(result.skippedLines, 0);
    assert.equal(store2.count(), 2);
  });

  it('skips lines with invalid HMAC', () => {
    const fs = new MemFs();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const store1 = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
    );
    store1.recover();
    store1.append(makeObs(0.1), createAppendToken());

    // Corrupt by appending a line with bad HMAC
    const filePath = [...fs.files.keys()].find(p => p.includes('observations-'))!;
    const existing = fs.files.get(filePath)!;
    const badLine = JSON.stringify({ ...makeObs(9.99), hmac: 'DEADBEEF' }) + '\n';
    fs.files.set(filePath, existing + badLine);

    const store2 = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
      (e) => events.push(e),
    );
    const result = store2.recover();
    assert.equal(result.validLines, 1);
    assert.equal(result.skippedLines, 1);
    assert.ok(events.some(e => e.type === 'cost.integrity_violation'));
  });

  it('skips malformed JSON lines', () => {
    const fs = new MemFs();
    const events: Array<{ type: string }> = [];
    fs.writeFileSync(join('/data', `observations-${currentMonth()}.jsonl`), 'not json\n');

    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
      (e) => events.push(e),
    );
    const result = store.recover();
    // Single bad line → total corruption path (no valid lines)
    assert.equal(result.corruptedFile, true);
    assert.ok(events.some(e => e.type === 'cost.observations_corrupted'));
  });

  it('wrong HMAC secret means nothing loads (renamed as corrupt)', () => {
    const fs = new MemFs();
    const events: Array<{ type: string }> = [];

    // Write with one secret
    const writer = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'SECRET_A' },
      fs,
    );
    writer.recover();
    writer.append(makeObs(0.1), createAppendToken());

    // Read with a different secret → should rename as corrupted
    const reader = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'WRONG_SECRET' },
      fs,
      (e) => events.push(e),
    );
    const result = reader.recover();
    assert.equal(result.corruptedFile, true);
    assert.ok(events.some(e => e.type === 'cost.observations_corrupted'));
  });

  it('handles empty file gracefully', () => {
    const fs = new MemFs();
    const store = new ObservationsStore(
      { dataDir: '/data', hmacSecret: 'secret' },
      fs,
    );
    const result = store.recover();
    assert.equal(result.validLines, 0);
    assert.equal(result.corruptedFile, false);
  });
});

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
