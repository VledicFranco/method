/**
 * Bridge Tool Provider — real filesystem-backed tools for cognitive sessions.
 *
 * Provides Read, Write, Glob, Grep, and Bash tools scoped to a workdir.
 * Used by cognitive-provider.ts to give the reasoner-actor real file access.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import type { ToolProvider, ToolDefinition, ToolResult } from '@method/pacta';

const TOOL_DEFS: ToolDefinition[] = [
  { name: 'Read', description: 'Read a file by path. Input: { path: string }' },
  { name: 'Write', description: 'Write content to a file. Input: { path: string, content: string }' },
  { name: 'Glob', description: 'Find files matching a glob pattern. Input: { pattern: string }' },
  { name: 'Grep', description: 'Search file contents with a regex. Input: { pattern: string, path?: string }' },
  { name: 'Bash', description: 'Execute a shell command. Input: { command: string }' },
];

const MAX_OUTPUT = 8000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '\n... (truncated)' : s;
}

export function createBridgeToolProvider(workdir: string): ToolProvider {
  return {
    list: () => TOOL_DEFS,

    async execute(name: string, input: unknown): Promise<ToolResult> {
      const args = (input ?? {}) as Record<string, string>;
      try {
        switch (name) {
          case 'Read': {
            const filePath = resolve(workdir, args.path);
            return { output: truncate(readFileSync(filePath, 'utf-8')) };
          }
          case 'Write': {
            const filePath = resolve(workdir, args.path);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, args.content, 'utf-8');
            return { output: `Written to ${args.path}` };
          }
          case 'Glob': {
            // Use git ls-files for tracked files, fall back to find
            try {
              const result = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', args.pattern], {
                cwd: workdir, encoding: 'utf-8', timeout: 10_000,
              });
              return { output: truncate(result) };
            } catch {
              const result = execSync(`find . -name "${args.pattern.replace(/"/g, '')}" -type f 2>/dev/null | head -50`, {
                cwd: workdir, encoding: 'utf-8', timeout: 10_000,
              });
              return { output: truncate(result) };
            }
          }
          case 'Grep': {
            const target = args.path || '.';
            const result = execFileSync('grep', ['-rn', '--include=*', '-m', '30', args.pattern, target], {
              cwd: workdir, encoding: 'utf-8', timeout: 10_000,
            });
            return { output: truncate(result) };
          }
          case 'Bash': {
            const result = execSync(args.command, {
              cwd: workdir, encoding: 'utf-8', timeout: 30_000,
            });
            return { output: truncate(result) };
          }
          default:
            return { output: `Unknown tool: ${name}`, isError: true };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { output: msg.slice(0, 2000), isError: true };
      }
    },
  };
}
