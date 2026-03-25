/**
 * VirtualToolProvider — ToolProvider backed by an in-memory Map<string, string>.
 *
 * Supports Read, Write, Edit, Glob, and Grep tool operations on a virtual
 * filesystem. No real host side effects. Tier 3 (virtual) fidelity.
 */

import type { ToolProvider, ToolDefinition, ToolResult } from '@method/pacta';

// ── Path normalization ───────────────────────────────────────────

function normalizePath(p: string): string {
  // Normalize slashes to forward, collapse doubles, remove trailing
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// ── VirtualToolProvider ──────────────────────────────────────────

export class VirtualToolProvider implements ToolProvider {
  private _files: Map<string, string>;
  private _callLog: Array<{ name: string; input: unknown; result: ToolResult }> = [];

  constructor(initialFiles?: Record<string, string>) {
    this._files = new Map();
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this._files.set(normalizePath(path), content);
      }
    }
  }

  /** Get the current virtual filesystem state */
  get files(): ReadonlyMap<string, string> {
    return this._files;
  }

  /** Get the call log for test inspection */
  get callLog(): ReadonlyArray<{ name: string; input: unknown; result: ToolResult }> {
    return this._callLog;
  }

  /** Read a file from virtual FS */
  getFile(path: string): string | undefined {
    return this._files.get(normalizePath(path));
  }

  /** Write a file to virtual FS (for test setup) */
  setFile(path: string, content: string): void {
    this._files.set(normalizePath(path), content);
  }

  list(): ToolDefinition[] {
    return [
      { name: 'Read', description: 'Read a file from the virtual filesystem' },
      { name: 'Write', description: 'Write a file to the virtual filesystem' },
      { name: 'Edit', description: 'Edit a file in the virtual filesystem' },
      { name: 'Glob', description: 'Find files by glob pattern in the virtual filesystem' },
      { name: 'Grep', description: 'Search file contents in the virtual filesystem' },
    ];
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    let result: ToolResult;
    switch (name) {
      case 'Read':
        result = this._handleRead(input);
        break;
      case 'Write':
        result = this._handleWrite(input);
        break;
      case 'Edit':
        result = this._handleEdit(input);
        break;
      case 'Glob':
        result = this._handleGlob(input);
        break;
      case 'Grep':
        result = this._handleGrep(input);
        break;
      default:
        result = { output: `Unknown tool: ${name}`, isError: true };
    }
    this._callLog.push({ name, input, result });
    return result;
  }

  // ── Tool Handlers ────────────────────────────────────────────

  private _handleRead(input: unknown): ToolResult {
    const params = input as { file_path?: string; offset?: number; limit?: number };
    if (!params.file_path) {
      return { output: 'Missing file_path parameter', isError: true };
    }

    const path = normalizePath(params.file_path);
    const content = this._files.get(path);
    if (content === undefined) {
      return { output: `File not found: ${path}`, isError: true };
    }

    const lines = content.split('\n');
    const offset = params.offset ?? 0;
    const limit = params.limit ?? lines.length;
    const sliced = lines.slice(offset, offset + limit);

    // Reproduce cat -n style output (1-indexed line numbers)
    const numbered = sliced.map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`);
    return { output: numbered.join('\n') };
  }

  private _handleWrite(input: unknown): ToolResult {
    const params = input as { file_path?: string; content?: string };
    if (!params.file_path) {
      return { output: 'Missing file_path parameter', isError: true };
    }
    if (params.content === undefined) {
      return { output: 'Missing content parameter', isError: true };
    }

    const path = normalizePath(params.file_path);
    this._files.set(path, params.content);
    return { output: `File written: ${path}` };
  }

  private _handleEdit(input: unknown): ToolResult {
    const params = input as {
      file_path?: string;
      old_string?: string;
      new_string?: string;
      replace_all?: boolean;
    };
    if (!params.file_path) {
      return { output: 'Missing file_path parameter', isError: true };
    }
    if (params.old_string === undefined) {
      return { output: 'Missing old_string parameter', isError: true };
    }
    if (params.new_string === undefined) {
      return { output: 'Missing new_string parameter', isError: true };
    }

    const path = normalizePath(params.file_path);
    const content = this._files.get(path);
    if (content === undefined) {
      return { output: `File not found: ${path}`, isError: true };
    }

    if (!content.includes(params.old_string)) {
      return { output: `old_string not found in ${path}`, isError: true };
    }

    let updated: string;
    if (params.replace_all) {
      updated = content.split(params.old_string).join(params.new_string);
    } else {
      // Check uniqueness — Edit tool requires old_string to be unique
      const firstIdx = content.indexOf(params.old_string);
      const secondIdx = content.indexOf(params.old_string, firstIdx + 1);
      if (secondIdx !== -1) {
        return {
          output: `old_string is not unique in ${path}. Use replace_all or provide more context.`,
          isError: true,
        };
      }
      updated = content.replace(params.old_string, params.new_string);
    }

    this._files.set(path, updated);
    return { output: `File edited: ${path}` };
  }

  private _handleGlob(input: unknown): ToolResult {
    const params = input as { pattern?: string; path?: string };
    if (!params.pattern) {
      return { output: 'Missing pattern parameter', isError: true };
    }

    const basePath = params.path ? normalizePath(params.path) : '';
    const pattern = params.pattern;
    const regex = globToRegex(pattern);

    const matches: string[] = [];
    for (const filePath of this._files.keys()) {
      const testPath = basePath ? filePath : filePath;
      // For path-prefixed searches, file must be under basePath
      if (basePath && !filePath.startsWith(basePath + '/') && filePath !== basePath) {
        continue;
      }
      // Match the relative path from base, or the full path
      const matchTarget = basePath ? filePath.slice(basePath.length + 1) : filePath;
      if (regex.test(matchTarget) || regex.test(filePath)) {
        matches.push(filePath);
      }
    }

    return { output: matches.sort().join('\n') || '(no matches)' };
  }

  private _handleGrep(input: unknown): ToolResult {
    const params = input as {
      pattern?: string;
      path?: string;
      glob?: string;
      output_mode?: 'content' | 'files_with_matches' | 'count';
    };
    if (!params.pattern) {
      return { output: 'Missing pattern parameter', isError: true };
    }

    const searchPath = params.path ? normalizePath(params.path) : '';
    const outputMode = params.output_mode ?? 'files_with_matches';
    let regex: RegExp;
    try {
      regex = new RegExp(params.pattern);
    } catch {
      return { output: `Invalid regex: ${params.pattern}`, isError: true };
    }

    const globRegex = params.glob ? globToRegex(params.glob) : null;
    const results: Array<{ file: string; line: number; content: string }> = [];

    for (const [filePath, content] of this._files.entries()) {
      // Path filter
      if (searchPath && !filePath.startsWith(searchPath + '/') && filePath !== searchPath) {
        continue;
      }
      // Glob filter
      if (globRegex && !globRegex.test(filePath)) {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({ file: filePath, line: i + 1, content: lines[i] });
        }
      }
    }

    if (outputMode === 'files_with_matches') {
      const uniqueFiles = [...new Set(results.map(r => r.file))];
      return { output: uniqueFiles.sort().join('\n') || '(no matches)' };
    }

    if (outputMode === 'count') {
      const counts = new Map<string, number>();
      for (const r of results) {
        counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
      }
      const lines = [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, count]) => `${file}:${count}`);
      return { output: lines.join('\n') || '(no matches)' };
    }

    // content mode
    const lines = results.map(r => `${r.file}:${r.line}:${r.content}`);
    return { output: lines.join('\n') || '(no matches)' };
  }
}

// ── Glob-to-Regex Utility ────────────────────────────────────────

function globToRegex(glob: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // ** matches any path segment(s)
      regex += '.*';
      i += 2;
      if (glob[i] === '/') i++; // skip trailing slash after **
    } else if (ch === '*') {
      // * matches anything except /
      regex += '[^/]*';
      i++;
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if (ch === '{') {
      // {a,b} alternation
      regex += '(?:';
      i++;
    } else if (ch === '}') {
      regex += ')';
      i++;
    } else if (ch === ',') {
      // Inside braces, comma becomes alternation
      regex += '|';
      i++;
    } else if (ch === '.') {
      regex += '\\.';
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}
