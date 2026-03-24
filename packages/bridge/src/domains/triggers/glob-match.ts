/**
 * PRD 018: Event Triggers — Minimal Glob Matcher (Phase 2a-1)
 *
 * Lightweight glob pattern matching without external dependencies.
 * Supports: *, **, ?, [chars], {a,b} braces.
 * Used by FileWatchTrigger and GitCommitTrigger for path/branch matching.
 */

/**
 * Match a string against a glob pattern.
 *
 * Patterns:
 *   *      — matches any sequence of characters except /
 *   **     — matches any sequence of characters including /
 *   ?      — matches exactly one character except /
 *   [abc]  — matches one character from the set
 *   {a,b}  — matches any of the comma-separated alternatives
 */
export function minimatch(str: string, pattern: string): boolean {
  // Normalize separators
  const normalizedStr = str.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle brace expansion first: {a,b,c} → try each alternative
  const braceMatch = normalizedPattern.match(/\{([^}]+)\}/);
  if (braceMatch) {
    const alternatives = braceMatch[1].split(',');
    const prefix = normalizedPattern.slice(0, braceMatch.index!);
    const suffix = normalizedPattern.slice(braceMatch.index! + braceMatch[0].length);
    return alternatives.some((alt) => minimatch(normalizedStr, prefix + alt.trim() + suffix));
  }

  // Convert glob to regex
  const regex = globToRegex(normalizedPattern);
  return regex.test(normalizedStr);
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];

    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches everything including /
        if (pattern[i + 2] === '/') {
          // **/ — matches zero or more directories
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          // ** at end or followed by non-/
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches everything except /
        regexStr += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
      i++;
    } else if (c === '[') {
      // Character class — pass through to regex
      const closeIdx = pattern.indexOf(']', i + 1);
      if (closeIdx === -1) {
        regexStr += escapeRegex(c);
        i++;
      } else {
        regexStr += pattern.slice(i, closeIdx + 1);
        i = closeIdx + 1;
      }
    } else {
      regexStr += escapeRegex(c);
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
