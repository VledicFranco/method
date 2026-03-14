import stripAnsi from 'strip-ansi';

/**
 * Box-drawing and TUI chrome characters used to detect decorative lines.
 */
const BOX_DRAWING_RE = /^[\s─│┌┐└┘├┤┬┴┼╭╮╰╯╴╵╶╷]+$/;

/**
 * TUI status patterns: progress bars, token counts, spinner lines, etc.
 */
const TUI_STATUS_RE = /^(\s*\d+%|\s*\d+\s*tokens?|\s*⠋|\s*⠙|\s*⠹|\s*⠸|\s*⠼|\s*⠴|\s*⠦|\s*⠧|\s*⠇|\s*⠏)/;

/**
 * Cursor-right escape sequence emitted by Claude Code's TUI.
 * Each occurrence represents a single character-width move right.
 */
const CURSOR_RIGHT_RE = /\x1b\[1C/g;

/**
 * Extract a clean response string from raw Claude Code PTY output.
 *
 * Algorithm:
 *  1. Find last ● marker — slice from there to end
 *  2. Replace \x1b[1C (cursor-right) with space
 *  3. Strip remaining ANSI escapes
 *  4. Simulate \r carriage-return overwriting per line
 *  5. Cut at ❯ (Claude Code input prompt)
 *  6. Filter TUI chrome lines
 *  7. Trim and return
 */
export function extractResponse(rawBuffer: string): string {
  // 1. Slice from last ● marker
  const markerIndex = rawBuffer.lastIndexOf('●');
  if (markerIndex === -1) {
    return '';
  }
  let text = rawBuffer.slice(markerIndex + 1);

  // 2. Replace cursor-right escapes with spaces
  text = text.replace(CURSOR_RIGHT_RE, ' ');

  // 3. Strip all remaining ANSI escape sequences
  text = stripAnsi(text);

  // 4. Simulate \r carriage-return overwriting
  const lines = text.split('\n').map(simulateCarriageReturn);

  // 5. Cut at ❯ prompt character
  const cutLines: string[] = [];
  for (const line of lines) {
    const promptIdx = line.indexOf('❯');
    if (promptIdx !== -1) {
      // Take content before the prompt character
      const before = line.slice(0, promptIdx);
      if (before.trim().length > 0) {
        cutLines.push(before);
      }
      break;
    }
    cutLines.push(line);
  }

  // 6. Filter TUI chrome lines
  const filtered = cutLines.filter((line) => {
    // Remove pure whitespace lines
    if (line.trim().length === 0) return false;
    // Remove box-drawing / decorative lines
    if (BOX_DRAWING_RE.test(line)) return false;
    // Remove TUI status lines
    if (TUI_STATUS_RE.test(line)) return false;
    return true;
  });

  // 7. Trim and return
  return filtered.join('\n').trim();
}

/**
 * Simulate terminal carriage-return behavior on a single line.
 * When \r appears, the cursor returns to column 0 and subsequent text
 * overwrites from the beginning. We keep only the content after the last \r.
 */
function simulateCarriageReturn(line: string): string {
  if (!line.includes('\r')) return line;
  const segments = line.split('\r');
  // The last segment is what remains visible after all overwrites
  return segments[segments.length - 1];
}
