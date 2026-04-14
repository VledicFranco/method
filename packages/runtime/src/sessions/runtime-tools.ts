/**
 * Runtime Tool Provider — real filesystem-backed tools for cognitive sessions.
 *
 * Provides Read, Write, Edit, Glob, Grep, and Bash tools scoped to a workdir.
 * Used by cognitive-provider.ts to give the reasoner-actor real file access.
 *
 * PRD-057 / S2 §3.3 / C5: moved from `bridge/domains/sessions/bridge-tools.ts`
 * to `runtime/sessions/runtime-tools.ts`. Legacy `createBridgeToolProvider`
 * is retained as an alias export for existing callers; new callers should
 * use `createRuntimeToolProvider`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import type { ToolProvider, ToolDefinition, ToolResult } from '@method/pacta';

const TOOL_DEFS: ToolDefinition[] = [
  { name: 'Read', description: 'Read a file by path. Input: { path: string, offset?: number, limit?: number } — offset/limit are line numbers (1-based start, count of lines). Use these for large files that exceed the 8000-char output limit.' },
  { name: 'Write', description: 'Write content to a file. Input: { path: string, content: string }' },
  { name: 'Edit', description: 'Replace a specific string in a file. Input: { path: string, old_string: string, new_string: string }' },
  { name: 'Glob', description: 'Find files matching a glob pattern. Input: { pattern: string }' },
  { name: 'Grep', description: 'Search file contents with a regex. Input: { pattern: string, path?: string }' },
  { name: 'Bash', description: 'Execute a shell command. Input: { command: string }' },
];

const MAX_OUTPUT = 8000;

const ALLOWED_COMMANDS = new Set(['git', 'npm', 'node', 'npx', 'ls', 'cat', 'find', 'grep', 'head', 'tail', 'wc', 'echo', 'pwd', 'which', 'diff', 'sort', 'uniq', 'tsc', 'test']);

/** Shell metacharacters that enable command chaining/injection. */
const SHELL_META = /[;|&`$(){}!<>\\]/;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '\n... (truncated)' : s;
}

function checkPathTraversal(workdir: string, filePath: string, rawPath: string): ToolResult | null {
  const rel = relative(workdir, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { output: `Path outside workdir not allowed: ${rawPath}`, isError: true };
  }
  return null;
}

/** Validate that a path argument stays within workdir (for Grep/Glob path args). */
function checkPathArg(workdir: string, pathArg: string): ToolResult | null {
  if (!pathArg || pathArg === '.') return null;
  const resolved = resolve(workdir, pathArg);
  return checkPathTraversal(workdir, resolved, pathArg);
}

/**
 * Canonical name after C5 rename (PRD-057 / S2 §3.3). Use this for new code.
 */
export function createRuntimeToolProvider(workdir: string): ToolProvider {
  return {
    list: () => TOOL_DEFS,

    async execute(name: string, input: unknown): Promise<ToolResult> {
      const args = (input ?? {}) as Record<string, string>;
      try {
        switch (name) {
          case 'Read': {
            const filePath = resolve(workdir, args.path);
            const traversalErr = checkPathTraversal(workdir, filePath, args.path);
            if (traversalErr) return traversalErr;
            const rawContent = readFileSync(filePath, 'utf-8');
            // Support optional offset (1-based line start) and limit (line count) for large files.
            if (args.offset !== undefined || args.limit !== undefined) {
              const lines = rawContent.split('\n');
              const start = Math.max(0, (Number(args.offset) || 1) - 1); // convert 1-based to 0-based
              const count = Number(args.limit) || (lines.length - start);
              const slice = lines.slice(start, start + count).join('\n');
              const totalLines = lines.length;
              const header = `Lines ${start + 1}-${Math.min(start + count, totalLines)} of ${totalLines}:\n`;
              return { output: truncate(header + slice) };
            }
            return { output: truncate(rawContent) };
          }
          case 'Write': {
            const filePath = resolve(workdir, args.path);
            const traversalErr = checkPathTraversal(workdir, filePath, args.path);
            if (traversalErr) return traversalErr;
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, args.content, 'utf-8');
            return { output: `Written to ${args.path}` };
          }
          case 'Edit': {
            const filePath = resolve(workdir, args.path);
            const traversalErr = checkPathTraversal(workdir, filePath, args.path);
            if (traversalErr) return traversalErr;
            const content = readFileSync(filePath, 'utf-8');
            const occurrences = content.split(args.old_string).length - 1;
            if (occurrences === 0) {
              return { output: 'String not found in file', isError: true };
            }
            if (occurrences >= 2) {
              return { output: `Ambiguous: string appears ${occurrences} times. Provide more context to make it unique.`, isError: true };
            }
            const updated = content.replace(args.old_string, args.new_string);
            writeFileSync(filePath, updated, 'utf-8');
            return { output: 'Edit applied successfully' };
          }
          case 'Glob': {
            // Reject patterns that attempt directory traversal
            if (args.pattern.includes('..')) {
              return { output: 'Glob patterns with ".." not allowed', isError: true };
            }
            // Use git ls-files for tracked files, fall back to find
            try {
              const result = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', args.pattern], {
                cwd: workdir, encoding: 'utf-8', timeout: 10_000,
              });
              return { output: truncate(result) };
            } catch {
              const result = execFileSync('find', ['.', '-name', args.pattern, '-type', 'f'], {
                cwd: workdir, encoding: 'utf-8', timeout: 10_000,
              });
              // Limit output to ~50 lines like the old head -50
              const lines = result.split('\n');
              const limited = lines.length > 50 ? lines.slice(0, 50).join('\n') : result;
              return { output: truncate(limited) };
            }
          }
          case 'Grep': {
            const target = args.path || '.';
            const pathErr = checkPathArg(workdir, target);
            if (pathErr) return pathErr;
            const result = execFileSync('grep', ['-rn', '--include=*', '-m', '30', args.pattern, target], {
              cwd: workdir, encoding: 'utf-8', timeout: 10_000,
            });
            return { output: truncate(result) };
          }
          case 'Bash': {
            const cmd = args.command.trim();
            const baseCommand = cmd.split(/\s+/)[0];
            if (!ALLOWED_COMMANDS.has(baseCommand)) {
              return { output: `Command not allowed: ${baseCommand}. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`, isError: true };
            }
            // Reject shell metacharacters that enable command chaining/injection
            if (SHELL_META.test(cmd)) {
              return { output: 'Shell metacharacters (;|&`$(){}!<>) not allowed in cognitive Bash tool', isError: true };
            }
            const result = execSync(cmd, {
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

/**
 * @deprecated Use `createRuntimeToolProvider`. Legacy alias preserved for
 * bridge-internal callers during the PRD-057 migration window; removed in C7.
 */
export const createBridgeToolProvider = createRuntimeToolProvider;
