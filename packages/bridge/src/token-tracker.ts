import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
}): TokenTracker {
  const sessions = new Map<string, SessionRecord>();

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
        const usage = parseSessionTokens(config.sessionsDir, record.workdir, record.startedAt);
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
 * named after the absolute path with path separators replaced by dashes.
 * e.g. /home/user/project → -home-user-project
 *
 * On Windows: C:\Users\user\project → C--Users-user-project
 */
function deriveProjectDirName(workdir: string): string {
  const abs = resolve(workdir);
  // Replace both / and \ with -, collapse leading separator
  return abs.replace(/[\\/]/g, '-').replace(/^-/, '');
}

/**
 * Find the project directory under sessionsDir that corresponds to workdir.
 * Tries the derived name first, then falls back to scanning directory names.
 */
function findProjectDir(sessionsDir: string, workdir: string): string | null {
  try {
    if (!existsSync(sessionsDir)) return null;

    const derived = deriveProjectDirName(workdir);

    // Try exact match first
    const exactPath = join(sessionsDir, derived);
    if (existsSync(exactPath)) return exactPath;

    // Fallback: scan directory names for ones that contain the workdir basename
    const absWorkdir = resolve(workdir);
    const entries = readdirSync(sessionsDir, { withFileTypes: true });

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
 * Find the most recent JSONL session file under the project's sessions/ dir
 * that was created after startedAt.
 */
function findSessionFile(projectDir: string, _startedAt: Date): string | null {
  try {
    const sessionsPath = join(projectDir, 'sessions');
    if (!existsSync(sessionsPath)) return null;

    const files = readdirSync(sessionsPath)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse(); // Most recent first (filenames typically include timestamps)

    return files.length > 0 ? join(sessionsPath, files[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Parse token usage from a Claude Code JSONL session file.
 */
function parseSessionTokens(
  sessionsDir: string,
  workdir: string,
  startedAt: Date,
): SessionTokenUsage | null {
  const projectDir = findProjectDir(sessionsDir, workdir);
  if (!projectDir) return null;

  const sessionFile = findSessionFile(projectDir, startedAt);
  if (!sessionFile) return null;

  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const usage = event.usage as Record<string, unknown> | undefined;
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
