// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';

// ── Types ──────────────────────────────────────────────────────

export type TranscriptToolCall = {
  name: string;
  input: string;
  duration?: number;
};

export interface CollapsedToolSummary {
  name: string;       // tool name (Read, Edit, Bash, Write, etc.)
  input: string;      // summarized input (file path or command, truncated)
  durationMs?: number; // computed from timestamp deltas if available
  status: 'completed' | 'error';
}

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

export type CollapsedTurn = TranscriptTurn & {
  toolSummaries?: CollapsedToolSummary[];
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

        const turns: TranscriptTurn[] = [];

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const msg = event.message as Record<string, unknown> | undefined;
            if (!msg) continue;

            const role = msg.role as string | undefined;
            if (role !== 'user' && role !== 'assistant') continue;

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

/**
 * Collapse tool-use rounds into (prompt, final_response) pairs.
 *
 * A "real user prompt" is a user turn whose content does NOT start with "[tool result:".
 * Between two real prompts, the last assistant turn with non-tool-call text is the response.
 * Intermediate tool-use / tool-result turns are dropped, but tool call information is
 * preserved as `toolSummaries` on the final assistant turn.
 */
export function collapseToolRounds(turns: TranscriptTurn[]): CollapsedTurn[] {
  const collapsed: CollapsedTurn[] = [];
  const realPromptIndices: number[] = [];

  // Identify real user prompts (not tool_result messages)
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === 'user' && !turns[i].content.startsWith('[tool result:')) {
      realPromptIndices.push(i);
    }
  }

  for (let k = 0; k < realPromptIndices.length; k++) {
    const promptIdx = realPromptIndices[k];
    const nextPromptIdx = k + 1 < realPromptIndices.length
      ? realPromptIndices[k + 1]
      : turns.length;

    // Emit the user prompt
    collapsed.push(turns[promptIdx]);

    // Collect tool summaries from all assistant turns in this cycle
    const toolSummaries: CollapsedToolSummary[] = [];

    // Find the last assistant turn with real text (not just tool calls) in this cycle
    let lastAssistantWithText: TranscriptTurn | null = null;
    for (let j = promptIdx + 1; j < nextPromptIdx; j++) {
      const t = turns[j];
      if (t.role === 'assistant' && t.toolCalls && t.toolCalls.length > 0) {
        // Find the corresponding tool_result user turn (next user turn after this assistant)
        let resultTurn: TranscriptTurn | undefined;
        for (let r = j + 1; r < nextPromptIdx; r++) {
          if (turns[r].role === 'user') {
            resultTurn = turns[r];
            break;
          }
        }

        // Compute duration from assistant tool_use timestamp to tool_result timestamp
        const toolUseTimestamp = new Date(t.timestamp).getTime();
        const resultTimestamp = resultTurn
          ? new Date(resultTurn.timestamp).getTime()
          : NaN;
        const durationMs = (!isNaN(toolUseTimestamp) && !isNaN(resultTimestamp) && resultTimestamp > toolUseTimestamp)
          ? resultTimestamp - toolUseTimestamp
          : undefined;

        // Determine status from tool_result content: if it contains error indicators, mark as error
        const resultContent = resultTurn?.content ?? '';
        const hasError = resultContent.toLowerCase().includes('error')
          || resultContent.toLowerCase().includes('failed')
          || resultContent.toLowerCase().includes('exception');

        for (const tc of t.toolCalls) {
          toolSummaries.push({
            name: tc.name,
            input: tc.input,
            durationMs,
            status: hasError ? 'error' : 'completed',
          });
        }
      }
      if (t.role === 'assistant' && !t.content.startsWith('[') && t.content !== '[empty]') {
        lastAssistantWithText = t;
      }
    }

    if (lastAssistantWithText) {
      const collapsedTurn: CollapsedTurn = { ...lastAssistantWithText };
      if (toolSummaries.length > 0) {
        collapsedTurn.toolSummaries = toolSummaries;
      }
      collapsed.push(collapsedTurn);
    }
  }

  return collapsed;
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
