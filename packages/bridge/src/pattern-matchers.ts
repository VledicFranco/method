// ── PRD 010: Pattern Matchers ───────────────────────────────────
// Pure functions that detect structured signals in PTY output.
// Each matcher receives cleaned text (ANSI-stripped) and returns matches.

export type ObservationCategory =
  | 'tool_call'
  | 'git_commit'
  | 'test_result'
  | 'build_result'
  | 'file_operation'
  | 'error'
  | 'idle'
  | 'permission_prompt';

export interface PatternMatch {
  category: ObservationCategory;
  channelTarget: 'progress' | 'events';
  messageType: string;
  content: Record<string, unknown>;
}

export type PatternMatcher = (text: string) => PatternMatch[];

// ── Pattern 1: Tool Call Detection ──────────────────────────────

const BUILTIN_TOOL_RE = /\b(Read|Edit|Write|Bash|Glob|Grep|TodoWrite|WebFetch|WebSearch|Agent|NotebookEdit)\b/g;
const MCP_TOOL_RE = /\b(mcp__\w+__\w+)\b/g;
const METHODOLOGY_TOOLS = new Set(['mcp__method__step_advance', 'mcp__method__step_current']);

export const matchToolCall: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(BUILTIN_TOOL_RE)) {
    const tool = m[1];
    if (seen.has(tool)) continue;
    seen.add(tool);
    matches.push({
      category: 'tool_call',
      channelTarget: 'progress',
      messageType: 'tool_call',
      content: { tool, is_mcp: false },
    });
  }

  for (const m of text.matchAll(MCP_TOOL_RE)) {
    const tool = m[1];
    if (seen.has(tool)) continue;
    seen.add(tool);
    matches.push({
      category: 'tool_call',
      channelTarget: 'progress',
      messageType: 'tool_call',
      content: { tool, is_mcp: true },
    });
    if (METHODOLOGY_TOOLS.has(tool)) {
      matches.push({
        category: 'tool_call',
        channelTarget: 'progress',
        messageType: 'methodology_activity',
        content: { tool },
      });
    }
  }

  return matches;
};

// ── Pattern 2: Git Commit Detection ─────────────────────────────

const GIT_COMMIT_RE = /\[(\S+)\s+([a-f0-9]{7,})\]\s+(.+)/g;

export const matchGitCommit: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];
  for (const m of text.matchAll(GIT_COMMIT_RE)) {
    matches.push({
      category: 'git_commit',
      channelTarget: 'progress',
      messageType: 'git_commit',
      content: { branch: m[1], hash: m[2], message: m[3].trim() },
    });
  }
  return matches;
};

// ── Pattern 3: Test Result Detection ────────────────────────────

const NODE_TEST_SUMMARY_RE = /# tests (\d+)/;
const NODE_TEST_PASS_RE = /# pass (\d+)/;
const NODE_TEST_FAIL_RE = /# fail (\d+)/;
const JEST_SUMMARY_RE = /Tests:\s+(?:(\d+) failed,\s+)?(\d+) passed,\s+(\d+) total/;
const MOCHA_PASS_RE = /(\d+) passing/;
const MOCHA_FAIL_RE = /(\d+) failing/;

export const matchTestResult: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];

  // Node.js test runner
  const testsMatch = NODE_TEST_SUMMARY_RE.exec(text);
  const passMatch = NODE_TEST_PASS_RE.exec(text);
  const failMatch = NODE_TEST_FAIL_RE.exec(text);
  if (testsMatch && passMatch) {
    const total = parseInt(testsMatch[1], 10);
    const passed = parseInt(passMatch[1], 10);
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    matches.push({
      category: 'test_result',
      channelTarget: 'progress',
      messageType: 'test_result',
      content: { total, passed, failed, runner: 'node' },
    });
    if (failed > 0) {
      matches.push({
        category: 'test_result',
        channelTarget: 'events',
        messageType: 'test_failure',
        content: { failed, total },
      });
    }
    return matches;
  }

  // Jest/Vitest
  const jestMatch = JEST_SUMMARY_RE.exec(text);
  if (jestMatch) {
    const failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
    const passed = parseInt(jestMatch[2], 10);
    const total = parseInt(jestMatch[3], 10);
    matches.push({
      category: 'test_result',
      channelTarget: 'progress',
      messageType: 'test_result',
      content: { total, passed, failed, runner: 'jest' },
    });
    if (failed > 0) {
      matches.push({
        category: 'test_result',
        channelTarget: 'events',
        messageType: 'test_failure',
        content: { failed, total },
      });
    }
    return matches;
  }

  // Mocha-style
  const mochaPass = MOCHA_PASS_RE.exec(text);
  if (mochaPass) {
    const passed = parseInt(mochaPass[1], 10);
    const mochaFail = MOCHA_FAIL_RE.exec(text);
    const failed = mochaFail ? parseInt(mochaFail[1], 10) : 0;
    const total = passed + failed;
    matches.push({
      category: 'test_result',
      channelTarget: 'progress',
      messageType: 'test_result',
      content: { total, passed, failed, runner: 'mocha' },
    });
    if (failed > 0) {
      matches.push({
        category: 'test_result',
        channelTarget: 'events',
        messageType: 'test_failure',
        content: { failed, total },
      });
    }
  }

  return matches;
};

// ── Pattern 4: File Operation Detection ─────────────────────────

const FILE_PATH_RE = /(?:Read|Write|Edit|file_path)[:\s]+["']?([^\s"']+\.\w{1,10})["']?/g;

export const matchFileOperation: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(FILE_PATH_RE)) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);

    // Determine operation from the prefix
    let operation: 'read' | 'write' | 'edit' = 'read';
    const prefix = text.substring(Math.max(0, m.index! - 10), m.index!);
    if (/Write/i.test(prefix) || /Write/.test(m[0])) operation = 'write';
    else if (/Edit/i.test(prefix) || /Edit/.test(m[0])) operation = 'edit';

    matches.push({
      category: 'file_operation',
      channelTarget: 'progress',
      messageType: 'file_activity',
      content: { path, operation },
    });
  }

  return matches;
};

// ── Pattern 5: Build Result Detection ───────────────────────────

const TSC_ERROR_RE = /error TS\d+:/g;
const BUILD_EXIT_RE = /exit code:\s*(\d+)/;

export const matchBuildResult: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];

  // Count TSC errors
  const tscErrors = [...text.matchAll(TSC_ERROR_RE)];
  if (tscErrors.length > 0) {
    matches.push({
      category: 'build_result',
      channelTarget: 'progress',
      messageType: 'build_result',
      content: { success: false, error_count: tscErrors.length },
    });
    matches.push({
      category: 'build_result',
      channelTarget: 'events',
      messageType: 'build_failure',
      content: { error_count: tscErrors.length },
    });
    return matches;
  }

  // Build exit code
  const exitMatch = BUILD_EXIT_RE.exec(text);
  if (exitMatch && text.includes('build')) {
    const exitCode = parseInt(exitMatch[1], 10);
    matches.push({
      category: 'build_result',
      channelTarget: 'progress',
      messageType: 'build_result',
      content: { success: exitCode === 0 },
    });
    if (exitCode !== 0) {
      matches.push({
        category: 'build_result',
        channelTarget: 'events',
        messageType: 'build_failure',
        content: { error_count: 0 },
      });
    }
  }

  return matches;
};

// ── Pattern 6: Idle Detection ───────────────────────────────────
// Idle detection requires state — handled in PtyWatcher, not here.
// The prompt character regex is exported for the watcher to use.

export const PROMPT_CHAR_RE = /❯/;

// ── Pattern 7: Error Detection ──────────────────────────────────

const STACK_TRACE_RE = /^\s+at\s+.+\(.+:\d+:\d+\)/m;
const NODE_ERROR_RE = /^(Error|TypeError|RangeError|SyntaxError|ReferenceError):\s+(.+)/m;
const EXIT_CODE_RE = /exit code:\s*([1-9]\d*)/;

export const matchError: PatternMatcher = (text) => {
  const matches: PatternMatch[] = [];

  const nodeError = NODE_ERROR_RE.exec(text);
  if (nodeError) {
    const hasStack = STACK_TRACE_RE.test(text);
    matches.push({
      category: 'error',
      channelTarget: 'events',
      messageType: 'error_detected',
      content: {
        error_type: nodeError[1],
        message: nodeError[2].substring(0, 200),
        has_stack_trace: hasStack,
      },
    });
    return matches;
  }

  // Non-zero exit code (only if not already captured as build result)
  const exitMatch = EXIT_CODE_RE.exec(text);
  if (exitMatch && !text.includes('build')) {
    matches.push({
      category: 'error',
      channelTarget: 'events',
      messageType: 'error_detected',
      content: {
        error_type: 'exit_code',
        message: `Process exited with code ${exitMatch[1]}`,
        has_stack_trace: false,
      },
    });
    return matches;
  }

  // Standalone stack trace without error header
  if (STACK_TRACE_RE.test(text) && !nodeError) {
    matches.push({
      category: 'error',
      channelTarget: 'events',
      messageType: 'error_detected',
      content: {
        error_type: 'stack_trace',
        message: 'Stack trace detected',
        has_stack_trace: true,
      },
    });
  }

  return matches;
};

// ── Pattern 8: Permission Prompt Detection (PRD 012) ────────────

const PERMISSION_PROMPT_RE = /\bAllow\b.*\?\s*\([Yy](?:es)?\/[Nn](?:o)?\)/;

export const matchPermissionPrompt: PatternMatcher = (text) => {
  if (PERMISSION_PROMPT_RE.test(text)) {
    return [{
      category: 'permission_prompt',
      channelTarget: 'events',
      messageType: 'permission_prompt_detected',
      content: {},
    }];
  }
  return [];
};

// ── Matcher Registry ────────────────────────────────────────────

export const ALL_MATCHERS: Array<{ category: ObservationCategory; matcher: PatternMatcher }> = [
  { category: 'tool_call', matcher: matchToolCall },
  { category: 'git_commit', matcher: matchGitCommit },
  { category: 'test_result', matcher: matchTestResult },
  { category: 'file_operation', matcher: matchFileOperation },
  { category: 'build_result', matcher: matchBuildResult },
  { category: 'error', matcher: matchError },
  { category: 'permission_prompt', matcher: matchPermissionPrompt },
];
