import { join, resolve } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';
import { NodeFileSystemProvider } from '../../ports/file-system.js';

// ── Types ──────────────────────────────────────────────────────

export type TranscriptToolCall = {
  name: string;
  input: string;
  duration?: number;
};

export type TranscriptTurn = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: TranscriptToolCall[];
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
  };
  timestamp: string;
};

export type SessionSummary = {
  file: string;
  modifiedAt: string;
  sizeBytes: number;
};

export type TranscriptReader = {
  listSessions(workdir: string): SessionSummary[];
  getTranscript(sessionFile: string): TranscriptTurn[];
};

// ── Implementation ─────────────────────────────────────────────

const defaultFs = new NodeFileSystemProvider();

/**
 * Derive the Claude Code project directory name from a workdir path.
 * Matches the logic in token-tracker.ts.
 */
export function deriveProjectDirName(workdir: string): string {
  const abs = resolve(workdir);
  return abs.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/^-/, '');
}

function findProjectDir(fs: FileSystemProvider, sessionsDir: string, workdir: string): string | null {
  try {
    if (!fs.existsSync(sessionsDir)) return null;
    const derived = deriveProjectDirName(workdir);
    const exactPath = join(sessionsDir, derived);
    if (fs.existsSync(exactPath)) return exactPath;
    return null;
  } catch {
    return null;
  }
}

export function createTranscriptReader(config: {
  sessionsDir: string;
  /** PRD 023 D2: File system provider for dependency injection. */
  fs?: FileSystemProvider;
}): TranscriptReader {
  const fs = config.fs ?? defaultFs;

  return {
    listSessions(workdir: string): SessionSummary[] {
      const projectDir = findProjectDir(fs, config.sessionsDir, workdir);
      if (!projectDir) return [];

      try {
        const files = fs.readdirSync(projectDir)
          .filter(f => f.endsWith('.jsonl'));

        return files.map(f => {
          const fullPath = join(projectDir, f);
          try {
            const stat = fs.statSync(fullPath);
            return {
              file: fullPath,
              modifiedAt: stat.mtime.toISOString(),
              sizeBytes: stat.size,
            };
          } catch {
            return {
              file: fullPath,
              modifiedAt: new Date(0).toISOString(),
              sizeBytes: 0,
            };
          }
        }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      } catch {
        return [];
      }
    },

    getTranscript(sessionFile: string): TranscriptTurn[] {
      try {
        const content = fs.readFileSync(sessionFile, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        const turns: TranscriptTurn[] = [];

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const msg = event.message as Record<string, unknown> | undefined;
            if (!msg) continue;

            const role = msg.role as string | undefined;
            if (role !== 'user' && role !== 'assistant') continue;

            // Extract text content
            let textContent = '';
            const toolCalls: TranscriptToolCall[] = [];

            const msgContent = msg.content;
            if (typeof msgContent === 'string') {
              textContent = msgContent;
            } else if (Array.isArray(msgContent)) {
              for (const block of msgContent) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text' && typeof b.text === 'string') {
                  textContent += (textContent ? '\n' : '') + b.text;
                } else if (b.type === 'tool_use') {
                  toolCalls.push({
                    name: String(b.name ?? 'unknown'),
                    input: summarizeInput(b.input),
                  });
                } else if (b.type === 'tool_result') {
                  // Tool results appear in user messages
                  const resultContent = b.content;
                  if (typeof resultContent === 'string') {
                    textContent += (textContent ? '\n' : '') + `[tool result: ${resultContent.substring(0, 200)}]`;
                  } else if (Array.isArray(resultContent)) {
                    for (const rc of resultContent) {
                      const r = rc as Record<string, unknown>;
                      if (r.type === 'text' && typeof r.text === 'string') {
                        textContent += (textContent ? '\n' : '') + `[tool result: ${r.text.substring(0, 200)}]`;
                      }
                    }
                  }
                }
              }
            }

            // Extract token usage
            const usage = (event.usage ?? msg.usage) as Record<string, unknown> | undefined;
            const tokens = usage ? {
              input: asNumber(usage.input_tokens),
              output: asNumber(usage.output_tokens),
              cacheRead: asNumber(usage.cache_read_input_tokens),
            } : undefined;

            turns.push({
              role: role as 'user' | 'assistant',
              content: textContent || (toolCalls.length > 0 ? `[${toolCalls.length} tool call(s)]` : '[empty]'),
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              tokens,
              timestamp: typeof event.timestamp === 'string'
                ? event.timestamp
                : new Date().toISOString(),
            });
          } catch {
            // Skip malformed lines
          }
        }

        return turns;
      } catch {
        return [];
      }
    },
  };
}

function summarizeInput(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input.substring(0, 120);
  try {
    const str = JSON.stringify(input);
    return str.substring(0, 120);
  } catch {
    return '[complex input]';
  }
}

function asNumber(val: unknown): number {
  return typeof val === 'number' ? val : 0;
}
