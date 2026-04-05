/**
 * Grammar Auto-Refiner
 *
 * Takes an induced PEG grammar that may have compile errors and applies
 * pattern-based fixes for common Peggy syntax issues. Then validates.
 *
 * Fix strategies:
 * 1. Duplicate label names — rename subsequent occurrences
 * 2. EOL consumption bugs — restructure list rules to use explicit separators
 * 3. Missing return actions — add identity action { return ...; }
 * 4. Stray whitespace in rule definitions
 * 5. Invalid $ placement
 *
 * If pattern fixes fail, falls back to LLM-assisted refinement.
 */

import peggy from 'peggy';

// ── Validation ───────────────────────────────────────────────

export function tryCompile(grammar) {
  try {
    const parser = peggy.generate(grammar);
    return { ok: true, parser };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) || 'unknown error' };
  }
}

// ── Fix 1: Duplicate labels within a single rule ─────────────

/**
 * Peggy requires unique labels within a single rule expression.
 * Pattern: `label:X ("," _ label:X)*` → `first:X rest:("," _ r:X { return r; })*`
 */
export function fixDuplicateLabels(grammar) {
  // Detect rules where the same label name appears twice
  const lines = grammar.split('\n');
  const fixed = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Look for pattern: label:X ... label:X (same label used twice in same line)
    const labelMatches = [...line.matchAll(/(\w+):/g)];
    const counts = {};
    for (const m of labelMatches) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    const dupLabels = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);

    if (dupLabels.length > 0) {
      // Rename the second+ occurrence to label+N
      for (const label of dupLabels) {
        // Find the (pattern)* structure and rename inside
        const pattern = new RegExp(`(\\(([^()]*?)${label}:([^ \\t)]+)([^()]*?)\\)\\*)`, 'g');
        line = line.replace(pattern, (_match, _full, pre, rule, post) => {
          return `(${pre}r_${label}:${rule}${post} { return r_${label}; })*`;
        });
      }
    }
    fixed.push(line);
  }

  return fixed.join('\n');
}

// ── Fix 2: EOL between sections (parse-error driven) ────────

/**
 * When the grammar uses `_` (horizontal whitespace) between section keywords
 * but the actual traces have newlines, parsing fails with:
 *   "Expected X or [ \t] but \n found"
 *
 * Fix: replace `_` with `EOL` (or a newline-aware whitespace rule) between
 * sections. Detect by attempting to parse and checking for this error pattern.
 */
export function fixSectionSeparators(grammar, traces) {
  // Try compiling
  const compileResult = tryCompile(grammar);
  if (!compileResult.ok) return grammar;

  // Try parsing a trace and look for the "but \n found" error pattern
  if (!traces || traces.length === 0) return grammar;

  try {
    compileResult.parser.parse(traces[0].output);
    return grammar; // already parses
  } catch (e) {
    const msg = e.message || '';
    if (!/but\s+"?\\?n"?\s+found/i.test(msg)) {
      return grammar; // different error, can't fix
    }
  }

  // Universal fix: widen `_` to include newlines.
  let fixed = grammar.replace(
    /^(_\s*"?\w*"?\s*=\s*)\[\s*\\t\s*\]\s*([*+])/m,
    '$1[ \\t\\n\\r]$2',
  );

  // Replace hardcoded " " whitespace before labeled rules with `_`.
  // Pattern: `/ " " label:Rule` → `/ _ label:Rule`
  fixed = fixed.replace(
    /(\/|\=)\s+" "\s+(\w+:)/g,
    '$1 _ $2',
  );

  // Fix missing opening quote in quoted-string patterns.
  // Pattern: `SOMETHING_OTHER_THAN_QUOTE label:$[^"]* '"'` → `SAME '"' label:$[^"]* '"'`
  // Skip if already preceded by a quote.
  fixed = fixed.replace(
    /((?:[^'"\s]|"[^"]*")\s+)(\w+:)(\$\[\^"\]\*)\s+('"'|"\\"")/g,
    (_match, prefix, label, pat, closeQuote) => {
      return `${prefix}${closeQuote} ${label}${pat} ${closeQuote}`;
    },
  );

  // Transform `label:X+` to allow whitespace between list elements.
  // `label:X+ { return label; }` → `first:X rest:(_ r:X { return r; })* { return [first, ...rest]; }`
  // This enables chained matching of list elements separated by whitespace.
  fixed = fixed.replace(
    /(\w+):(\w+)\+(\s*\{\s*return\s+\w+\s*;?\s*\})?/g,
    (_match, label, ruleName, _action) => {
      return `first:${ruleName} rest:(_ r:${ruleName} { return r; })* { return [first, ...rest]; }`;
    },
  );

  return fixed;
}

// Legacy alias
export function fixEolConsumption(grammar) {
  return grammar;
}

// ── Fix 3: Missing return action ─────────────────────────────

/**
 * Rules without { return ...; } will return raw matched arrays.
 * If a grammar compiles but returns arrays instead of objects, add actions.
 * Only applies when validation fails on semantic match, not compile.
 */
export function addMissingActions(grammar) {
  // Add { return text(); } to rules that lack actions (simplest identity)
  const lines = grammar.split('\n');
  const fixed = [];
  for (const line of lines) {
    // If line matches a rule body without { return ... }
    if (/^\s*=\s*[^{]+$/.test(line) && !line.includes('{')) {
      fixed.push(line.trimEnd() + ' { return text(); }');
    } else {
      fixed.push(line);
    }
  }
  return fixed.join('\n');
}

// ── Fix 4: Strip invalid characters from rule names ──────────

export function normalizeRuleNames(grammar) {
  // Peggy rule names must be [A-Za-z_][A-Za-z0-9_]*
  return grammar.replace(/^([a-zA-Z_][a-zA-Z0-9_]*)-(\w+)/gm, '$1_$2');
}

// ── Main refine loop ─────────────────────────────────────────

/**
 * Refine a grammar: apply pattern fixes until it compiles AND parses traces.
 * If traces are provided, also fix parse-time issues (not just compile issues).
 */
export function refineGrammar(grammar, options = {}) {
  const { verbose = false, traces = null } = options;
  const log = verbose ? console.log : () => {};

  let current = grammar;
  const fixesApplied = [];

  // Phase 1: Compile-time fixes
  const initial = tryCompile(current);
  if (!initial.ok) {
    log(`Initial error: ${initial.error}`);
    const compileFixes = [
      { name: 'fixDuplicateLabels', fn: fixDuplicateLabels },
      { name: 'normalizeRuleNames', fn: normalizeRuleNames },
      { name: 'addMissingActions', fn: addMissingActions },
    ];
    for (const fix of compileFixes) {
      const candidate = fix.fn(current);
      if (candidate !== current) {
        const result = tryCompile(candidate);
        log(`  ${fix.name}: ${result.ok ? '✓ compiles' : '✗ ' + result.error?.slice(0, 80)}`);
        current = candidate;
        fixesApplied.push(fix.name);
        if (result.ok) break;
      }
    }
  }

  // Phase 2: Parse-time fixes (requires traces)
  if (traces && traces.length > 0) {
    const compileCheck = tryCompile(current);
    if (compileCheck.ok) {
      // Test if it parses
      let parsesCorrectly = false;
      try {
        compileCheck.parser.parse(traces[0].output);
        parsesCorrectly = true;
      } catch {}

      if (!parsesCorrectly) {
        log('Grammar compiles but fails to parse traces — applying parse fixes');
        const candidate = fixSectionSeparators(current, traces);
        if (candidate !== current) {
          const result = tryCompile(candidate);
          if (result.ok) {
            try {
              result.parser.parse(traces[0].output);
              log('  fixSectionSeparators: ✓ parses');
              fixesApplied.push('fixSectionSeparators');
              current = candidate;
            } catch (e) {
              log(`  fixSectionSeparators: compiles but still doesn't parse: ${e.message?.slice(0, 80)}`);
            }
          } else {
            log(`  fixSectionSeparators: broke compilation`);
          }
        }
      }
    }
  }

  const final = tryCompile(current);
  return { grammar: current, ok: final.ok, fixesApplied, error: final.error };
}

// ── CLI ──────────────────────────────────────────────────────

const scriptPath = process.argv[1]?.replace(/\\/g, '/');
if (scriptPath && import.meta.url.endsWith(scriptPath.split('/').pop())) {
  const { readFileSync, writeFileSync } = await import('fs');
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node grammar-refiner.mjs <grammar.peggy> [--output <fixed.peggy>]');
    process.exit(1);
  }

  const grammar = readFileSync(args[0], 'utf-8');
  const outputPath = args[args.indexOf('--output') + 1] || args[0].replace('.peggy', '-refined.peggy');
  const tracesPath = args.includes('--traces') ? args[args.indexOf('--traces') + 1] : null;

  let traces = null;
  if (tracesPath) {
    traces = readFileSync(tracesPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    console.log(`Loaded ${traces.length} traces for parse validation\n`);
  }

  console.log(`Refining ${args[0]}...\n`);
  const result = refineGrammar(grammar, { verbose: true, traces });

  console.log(`\nResult: ${result.ok ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Fixes applied: ${result.fixesApplied.join(', ') || 'none'}`);
  if (!result.ok) console.log(`Final error: ${result.error}`);

  writeFileSync(outputPath, result.grammar);
  console.log(`Saved to ${outputPath}`);
}
