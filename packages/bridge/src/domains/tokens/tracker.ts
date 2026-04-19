// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';

export type SessionTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cacheHitRate: number;     // 0-100
};

export type AggregateTokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  sessionCount: number;
};

export type TokenTracker = {
  registerSession(sessionId: string, workdir: string, startedAt: Date): void;
  refreshUsage(sessionId: string): SessionTokenUsage | null;
  getUsage(sessionId: string): SessionTokenUsage | null;
  getAggregate(): AggregateTokenUsage;
};

interface SessionRecord {
  workdir: string;
  startedAt: Date;
  cached: SessionTokenUsage | null;
}

export function createTokenTracker(config: {
  sessionsDir: string;
  /** PRD 023 D2: File system provider for dependency injection. */
  fs: FileSystemProvider;
}): TokenTracker {
  const sessions = new Map<string, SessionRecord>();
  const fs = config.fs;

  return {
    registerSession(sessionId: string, workdir: string, startedAt: Date): void {
      sessions.set(sessionId, {
        workdir,
        startedAt,
        cached: null,
      });
    },

    refreshUsage(sessionId: string): SessionTokenUsage | null {
      const record = sessions.get(sessionId);
      if (!record) return null;

      try {
        const usage = parseSessionTokens(fs, config.sessionsDir, record.workdir, record.startedAt);
        if (usage) {
          record.cached = usage;
        }
        return record.cached;
      } catch {
        return record.cached;
      }
    },

    getUsage(sessionId: string): SessionTokenUsage | null {
      const record = sessions.get(sessionId);
      return record?.cached ?? null;
    },

    getAggregate(): AggregateTokenUsage {
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let sessionCount = 0;

      for (const record of sessions.values()) {
        if (record.cached) {
          inputTokens += record.cached.inputTokens;
          outputTokens += record.cached.outputTokens;
          cacheReadTokens += record.cached.cacheReadTokens;
          cacheWriteTokens += record.cached.cacheWriteTokens;
          sessionCount++;
        }
      }

      const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
      const denominator = inputTokens + cacheReadTokens;
      const cacheHitRate = denominator > 0 ? (cacheReadTokens / denominator) * 100 : 0;

      return {
        totalTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheHitRate,
        sessionCount,
      };
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Derive the Claude Code project directory name from a workdir path.
 *
 * Claude Code stores project data under ~/.claude/projects/ in directories
 * named after the absolute path with separators replaced:
 *   - Path separators (/ and \) become -
 *   - Drive letter colon becomes -- (e.g. C: → C--)
 *   - Leading separator is collapsed
 *
 * Examples:
 *   /home/user/project → -home-user-project
 *   C:\Users\user\project → C--Users-user-project
 */
export function deriveProjectDirName(workdir: string): string {
  const abs = resolve(workdir);
  // Replace colon with --, then separators with -, collapse leading separator
  return abs.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/^-/, '');
}

/**
 * Find the project directory under sessionsDir that corresponds to workdir.
 * Tries the derived name first, then falls back to scanning directory names.
 */
function findProjectDir(fs: FileSystemProvider, sessionsDir: string, workdir: string): string | null {
  try {
    if (!fs.existsSync(sessionsDir)) return null;

    const derived = deriveProjectDirName(workdir);

    // Try exact match first
    const exactPath = join(sessionsDir, derived);
    if (fs.existsSync(exactPath)) return exactPath;

    // Fallback: scan directory names for ones that contain the workdir basename
    const absWorkdir = resolve(workdir);
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check if the directory name maps back to our workdir
      // by seeing if the workdir path segments appear in order
      const dirName = entry.name;
      const reconstructed = dirName.replace(/^([A-Z]):/, '$1:\\').replace(/-/g, '/');
      if (reconstructed === absWorkdir || reconstructed === absWorkdir.replace(/\\/g, '/')) {
        return join(sessionsDir, dirName);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Find the most recent JSONL session file in the project directory.
 *
 * Claude Code stores JSONL files directly in the project directory
 * (not in a sessions/ subdirectory). Files are named {uuid}.jsonl.
 * We pick the most recently modified one.
 */
function findSessionFile(fs: FileSystemProvider, projectDir: string, _startedAt: Date): string | null {
  try {
    const files = fs.readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'));

    if (files.length === 0) return null;

    // Sort by modification time, most recent first
    const withStats = files.map((f) => {
      const fullPath = join(projectDir, f);
      try {
        const stat = fs.statSync(fullPath);
        return { path: fullPath, mtime: stat.mtimeMs };
      } catch {
        return { path: fullPath, mtime: 0 };
      }
    });
    withStats.sort((a, b) => b.mtime - a.mtime);

    return withStats[0].path;
  } catch {
    return null;
  }
}

/**
 * Parse token usage from a Claude Code JSONL session file.
 */
function parseSessionTokens(
  fs: FileSystemProvider,
  sessionsDir: string,
  workdir: string,
  startedAt: Date,
): SessionTokenUsage | null {
  const projectDir = findProjectDir(fs, sessionsDir, workdir);
  if (!projectDir) return null;

  const sessionFile = findSessionFile(fs, projectDir, startedAt);
  if (!sessionFile) return null;

  try {
    const content = fs.readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        // Usage can be at top level or nested under message.usage
        const msg = event.message as Record<string, unknown> | undefined;
        const usage = (event.usage ?? msg?.usage) as Record<string, unknown> | undefined;
        if (!usage || typeof usage !== 'object') continue;

        inputTokens += asNumber(usage.input_tokens);
        outputTokens += asNumber(usage.output_tokens);
        cacheReadTokens += asNumber(usage.cache_read_input_tokens);
        cacheWriteTokens += asNumber(usage.cache_creation_input_tokens);
      } catch {
        // Skip malformed lines
      }
    }

    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    const denominator = inputTokens + cacheReadTokens;
    const cacheHitRate = denominator > 0 ? (cacheReadTokens / denominator) * 100 : 0;

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      cacheHitRate,
    };
  } catch {
    return null;
  }
}

function asNumber(val: unknown): number {
  return typeof val === 'number' ? val : 0;
}
