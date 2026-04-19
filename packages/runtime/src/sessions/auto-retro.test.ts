// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateAutoRetro, type AutoRetroInput } from './auto-retro.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import {
  readFile as nodeReadFile,
  writeFile as nodeWriteFile,
  appendFile as nodeAppendFile,
  readdir as nodeReaddir,
  stat as nodeStat,
  access as nodeAccess,
  mkdir as nodeMkdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import type { ActivityObservation } from './auto-retro.js';
import type { FileSystemProvider, DirEntry, FileStat } from '../ports/file-system.js';

// ── Helpers ──────────────────────────────────────────────────────

// Local test FS — mirrors NodeFileSystemProvider (bridge-only) without a
// cross-package import. Keeps auto-retro.test.ts inside @methodts/runtime.
class TestNodeFs implements FileSystemProvider {
  readFileSync(path: string, encoding: BufferEncoding): string {
    return readFileSync(path, encoding);
  }
  writeFileSync(path: string, content: string, options?: { encoding?: BufferEncoding; mode?: number }): void {
    writeFileSync(path, content, options);
  }
  existsSync(path: string): boolean {
    return existsSync(path);
  }
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    return options?.withFileTypes
      ? readdirSync(path, { withFileTypes: true })
      : readdirSync(path);
  }
  statSync(path: string): FileStat {
    return statSync(path);
  }
  unlinkSync(path: string): void { unlinkSync(path); }
  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    mkdirSync(path, options);
  }
  renameSync(oldPath: string, newPath: string): void { renameSync(oldPath, newPath); }
  realpathSync(path: string): string { return realpathSync(path); }
  async readFile(path: string, encoding: BufferEncoding): Promise<string> {
    return nodeReadFile(path, encoding);
  }
  async writeFile(path: string, content: string, encoding: BufferEncoding): Promise<void> {
    await nodeWriteFile(path, content, encoding);
  }
  async appendFile(path: string, content: string, encoding: BufferEncoding): Promise<void> {
    await nodeAppendFile(path, content, encoding);
  }
  async readdir(path: string): Promise<string[]> { return nodeReaddir(path); }
  async stat(path: string): Promise<FileStat> { return nodeStat(path); }
  async access(path: string): Promise<void> { return nodeAccess(path); }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await nodeMkdir(path, options);
  }
}

const testFs = new TestNodeFs();

function makeInput(projectRoot: string, overrides?: Partial<AutoRetroInput>): AutoRetroInput {
  return {
    sessionId: 'test-session-001',
    nickname: 'impl-1',
    observations: [],
    spawnedAt: new Date('2026-03-15T14:00:00Z'),
    terminatedAt: new Date('2026-03-15T14:30:00Z'),
    terminationReason: 'completed',
    projectRoot,
    fs: testFs,
    ...overrides,
  };
}

function obs(category: string, detail: Record<string, unknown>): ActivityObservation {
  return { timestamp: new Date().toISOString(), category, detail };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Auto-Retro Generator (PRD 013)', () => {
  let tmpDir: string;
  let retrosDir: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `auto-retro-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    retrosDir = join(tmpDir, '.method', 'retros');
    mkdirSync(retrosDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── Basic generation ──────────────────────────────────────────

  describe('YAML generation', () => {
    it('writes retro file with correct structure', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      assert.equal(result.written, true);
      assert.ok(result.path);
      assert.ok(existsSync(result.path!));

      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('session_id: "test-session-001"'));
      assert.ok(content.includes('nickname: "impl-1"'));
      assert.ok(content.includes('generated_by: pty-watcher'));
      assert.ok(content.includes('termination_reason: "completed"'));
    });

    it('includes auto-generated header comment', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.startsWith('# Auto-generated retrospective'));
    });

    it('includes placeholder sections', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('hardest_decision: "(auto-generated — not available)"'));
      assert.ok(content.includes('essence_feedback: "(auto-generated — not available)"'));
    });
  });

  // ── Timing calculations ───────────────────────────────────────

  describe('timing', () => {
    it('computes duration in minutes', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        spawnedAt: new Date('2026-03-15T14:00:00Z'),
        terminatedAt: new Date('2026-03-15T14:45:00Z'),
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('duration_minutes: 45'));
    });

    it('computes active vs idle minutes', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        spawnedAt: new Date('2026-03-15T14:00:00Z'),
        terminatedAt: new Date('2026-03-15T15:00:00Z'),
        observations: [
          obs('idle', { idle_after_seconds: 600 }),  // 10 min idle
          obs('idle', { idle_after_seconds: 300 }),  // 5 min idle
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      // Total 60 min, 15 min idle → 45 min active
      assert.ok(content.includes('duration_minutes: 60'));
      assert.ok(content.includes('idle_minutes: 15'));
      assert.ok(content.includes('active_minutes: 45'));
    });

    it('clamps active minutes to zero when idle exceeds duration', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        spawnedAt: new Date('2026-03-15T14:00:00Z'),
        terminatedAt: new Date('2026-03-15T14:10:00Z'),
        observations: [
          obs('idle', { idle_after_seconds: 900 }), // 15 min > 10 min duration
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('active_minutes: 0'));
    });

    it('records spawned_at and terminated_at as ISO strings', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('spawned_at: "2026-03-15T14:00:00.000Z"'));
      assert.ok(content.includes('terminated_at: "2026-03-15T14:30:00.000Z"'));
    });

    it('records termination reason', () => {
      for (const reason of ['completed', 'killed', 'stale', 'exited'] as const) {
        const result = generateAutoRetro(makeInput(tmpDir, { terminationReason: reason }));
        const content = readFileSync(result.path!, 'utf-8');
        assert.ok(content.includes(`termination_reason: "${reason}"`));
      }
    });
  });

  // ── Activity summary ──────────────────────────────────────────

  describe('activity summary', () => {
    it('counts tool calls', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('tool_call', { tool: 'Read', is_mcp: false }),
          obs('tool_call', { tool: 'Edit', is_mcp: false }),
          obs('tool_call', { tool: 'Read', is_mcp: false }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tool_calls: 3'));
    });

    it('generates tool breakdown sorted by frequency', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('tool_call', { tool: 'Read', is_mcp: false }),
          obs('tool_call', { tool: 'Read', is_mcp: false }),
          obs('tool_call', { tool: 'Read', is_mcp: false }),
          obs('tool_call', { tool: 'Edit', is_mcp: false }),
          obs('tool_call', { tool: 'Edit', is_mcp: false }),
          obs('tool_call', { tool: 'Bash', is_mcp: false }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tool_breakdown:'));
      assert.ok(content.includes('- tool: Read'));
      assert.ok(content.includes('  count: 3'));
      assert.ok(content.includes('- tool: Edit'));
      assert.ok(content.includes('  count: 2'));

      // Read (3) should appear before Edit (2)
      const readIdx = content.indexOf('- tool: Read');
      const editIdx = content.indexOf('- tool: Edit');
      assert.ok(readIdx < editIdx);
    });

    it('shows empty tool_breakdown when no tool calls', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tool_breakdown: []'));
    });

    it('collects files touched from file_operation observations', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('file_operation', { path: '/src/index.ts', operation: 'read' }),
          obs('file_operation', { path: '/src/pool.ts', operation: 'edit' }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('files_touched:'));
      assert.ok(content.includes('- /src/index.ts'));
      assert.ok(content.includes('- /src/pool.ts'));
    });

    it('deduplicates files touched', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('file_operation', { path: '/src/index.ts', operation: 'read' }),
          obs('file_operation', { path: '/src/index.ts', operation: 'edit' }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      // Should only appear once
      const matches = content.match(/- \/src\/index\.ts/g);
      assert.equal(matches?.length, 1);
    });

    it('shows empty files_touched when no file operations', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('files_touched: []'));
    });

    it('records git commits', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('git_commit', { branch: 'main', hash: 'abc1234', message: 'feat: add feature' }),
          obs('git_commit', { branch: 'main', hash: 'def5678', message: 'fix: bug fix' }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('git_commits:'));
      assert.ok(content.includes('hash: abc1234'));
      assert.ok(content.includes('message: "feat: add feature"'));
      assert.ok(content.includes('hash: def5678'));
    });

    it('shows empty git_commits when none', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('git_commits: []'));
    });
  });

  // ── Quality section ───────────────────────────────────────────

  describe('quality', () => {
    it('reports tests_run: false when no test results', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tests_run: false'));
    });

    it('reports last test result when tests were run', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('test_result', { total: 10, passed: 8, failed: 2, runner: 'node' }),
          obs('test_result', { total: 14, passed: 14, failed: 0, runner: 'node' }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tests_run: true'));
      // Uses last test result
      assert.ok(content.includes('total: 14'));
      assert.ok(content.includes('passed: 14'));
      assert.ok(content.includes('failed: 0'));
    });

    it('reports build_succeeded from last build result', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('build_result', { success: false, error_count: 3 }),
          obs('build_result', { success: true, error_count: 0 }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('build_succeeded: true'));
    });

    it('reports build_succeeded: null when no builds', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('build_succeeded: null'));
    });

    it('counts errors observed', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        observations: [
          obs('error', { error_type: 'TypeError', has_stack_trace: true }),
          obs('error', { error_type: 'ReferenceError', has_stack_trace: false }),
        ],
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('errors_observed: 2'));
    });
  });

  // ── YAML escaping ─────────────────────────────────────────────

  describe('YAML escaping', () => {
    it('escapes double quotes in session ID', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        sessionId: 'session-with-"quotes"',
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('session_id: "session-with-\\"quotes\\""'));
    });

    it('escapes backslashes in nickname', () => {
      const result = generateAutoRetro(makeInput(tmpDir, {
        nickname: 'impl\\test',
      }));
      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('nickname: "impl\\\\test"'));
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('returns written: false when retros dir does not exist', () => {
      const result = generateAutoRetro(makeInput('/nonexistent/path'));
      assert.equal(result.written, false);
      assert.equal(result.path, null);
      assert.ok(result.reason?.includes('not found'));
    });
  });

  // ── Filename sequencing ───────────────────────────────────────

  describe('filename sequencing', () => {
    it('starts at 001', () => {
      const result = generateAutoRetro(makeInput(tmpDir));
      assert.ok(result.path?.includes('-001.yaml'));
    });

    it('increments sequence for same date', () => {
      const r1 = generateAutoRetro(makeInput(tmpDir, { sessionId: 'seq-1' }));
      const r2 = generateAutoRetro(makeInput(tmpDir, { sessionId: 'seq-2' }));
      const r3 = generateAutoRetro(makeInput(tmpDir, { sessionId: 'seq-3' }));

      assert.ok(r1.path?.includes('-001.yaml'));
      assert.ok(r2.path?.includes('-002.yaml'));
      assert.ok(r3.path?.includes('-003.yaml'));
    });
  });

  // ── All observation categories together ───────────────────────

  describe('comprehensive observation handling', () => {
    it('processes all observation categories in one retro', () => {
      const allObs: ActivityObservation[] = [
        obs('tool_call', { tool: 'Read', is_mcp: false }),
        obs('tool_call', { tool: 'Edit', is_mcp: false }),
        obs('git_commit', { branch: 'feat', hash: 'aaa1111', message: 'feat: test' }),
        obs('test_result', { total: 5, passed: 5, failed: 0, runner: 'node' }),
        obs('file_operation', { path: '/src/main.ts', operation: 'edit' }),
        obs('build_result', { success: true, error_count: 0 }),
        obs('error', { error_type: 'Warning', has_stack_trace: false }),
        obs('idle', { idle_after_seconds: 120 }),
      ];

      const result = generateAutoRetro(makeInput(tmpDir, { observations: allObs }));
      assert.equal(result.written, true);

      const content = readFileSync(result.path!, 'utf-8');
      assert.ok(content.includes('tool_calls: 2'));
      assert.ok(content.includes('hash: aaa1111'));
      assert.ok(content.includes('tests_run: true'));
      assert.ok(content.includes('- /src/main.ts'));
      assert.ok(content.includes('build_succeeded: true'));
      assert.ok(content.includes('errors_observed: 1'));
      assert.ok(content.includes('idle_minutes: 2'));
    });
  });
});
