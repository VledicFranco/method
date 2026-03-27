import { join, resolve } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';

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
  fs: FileSystemProvider;
}): TranscriptReader {
  const fs = config.fs;

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

        // Phase 1: Parse all JSONL events into raw turns with metadata
        const raw: Array<{
          role: 'user' | 'assistant';
          text: string;
          toolCalls: TranscriptToolCall[];
          isToolResult: boolean;   // user turn that is only tool_result blocks
          hasText: boolean;        // assistant turn that has real text content
          tokens?: { input: number; output: number; cacheRead: number };
          timestamp: string;
        }> = [];

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const msg = event.message as Record<string, unknown> | undefined;
            if (!msg) continue;

            const role = msg.role as string | undefined;
            if (role !== 'user' && role !== 'assistant') continue;

            let textContent = '';
            const toolCalls: TranscriptToolCall[] = [];
            let hasToolResult = false;
            let hasToolUse = false;

            const msgContent = msg.content;
            if (typeof msgContent === 'string') {
              textContent = msgContent;
            } else if (Array.isArray(msgContent)) {
              for (const block of msgContent) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text' && typeof b.text === 'string') {
                  textContent += (textContent ? '\n' : '') + b.text;
                } else if (b.type === 'tool_use') {
                  hasToolUse = true;
                  toolCalls.push({
                    name: String(b.name ?? 'unknown'),
                    input: summarizeInput(b.input),
                  });
                } else if (b.type === 'tool_result') {
                  hasToolResult = true;
                }
              }
            }

            const usage = (event.usage ?? msg.usage) as Record<string, unknown> | undefined;
            const tokens = usage ? {
              input: asNumber(usage.input_tokens),
              output: asNumber(usage.output_tokens),
              cacheRead: asNumber(usage.cache_read_input_tokens),
            } : undefined;

            raw.push({
              role: role as 'user' | 'assistant',
              text: textContent,
              toolCalls,
              isToolResult: role === 'user' && hasToolResult && !textContent,
              hasText: role === 'assistant' ? textContent.length > 0 : !hasToolUse,
              tokens,
              timestamp: typeof event.timestamp === 'string'
                ? event.timestamp
                : new Date().toISOString(),
            });
          } catch {
            // Skip malformed lines
          }
        }

        // Phase 2: Collapse tool-use rounds into (prompt, final_response) pairs.
        // A "real user prompt" is a user turn that is NOT a tool_result message.
        // Between two real prompts, the last assistant turn with text is the response.
        const collapsed: TranscriptTurn[] = [];
        let currentPromptIdx = -1;

        for (let i = 0; i < raw.length; i++) {
          const turn = raw[i];

          if (turn.role === 'user' && !turn.isToolResult) {
            // Flush previous prompt cycle
            if (currentPromptIdx >= 0) {
              flushCycle(raw, currentPromptIdx, i, collapsed);
            }
            currentPromptIdx = i;
          }
        }

        // Flush final cycle
        if (currentPromptIdx >= 0) {
          flushCycle(raw, currentPromptIdx, raw.length, collapsed);
        }

        return collapsed;
      } catch {
        return [];
      }
    },
  };
}

/**
 * Flush a prompt cycle [promptIdx, nextPromptIdx) into collapsed turns.
 * Emits the real user prompt + the last assistant turn that has text content.
 */
function flushCycle(
  raw: Array<{
    role: 'user' | 'assistant';
    text: string;
    toolCalls: TranscriptToolCall[];
    isToolResult: boolean;
    hasText: boolean;
    tokens?: { input: number; output: number; cacheRead: number };
    timestamp: string;
  }>,
  promptIdx: number,
  nextPromptIdx: number,
  out: TranscriptTurn[],
): void {
  const prompt = raw[promptIdx];
  out.push({
    role: 'user',
    content: prompt.text || '[empty]',
    timestamp: prompt.timestamp,
  });

  // Find the last assistant turn with real text in this cycle
  let lastAssistant: typeof raw[number] | null = null;
  for (let j = promptIdx + 1; j < nextPromptIdx; j++) {
    if (raw[j].role === 'assistant' && raw[j].hasText) {
      lastAssistant = raw[j];
    }
  }

  if (lastAssistant) {
    out.push({
      role: 'assistant',
      content: lastAssistant.text,
      toolCalls: lastAssistant.toolCalls.length > 0 ? lastAssistant.toolCalls : undefined,
      tokens: lastAssistant.tokens,
      timestamp: lastAssistant.timestamp,
    });
  }
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
