// SPDX-License-Identifier: Apache-2.0
/**
 * GlyphJS block linter — validates ui: fenced code blocks in agent responses.
 *
 * Extracts ui:* blocks, compiles each with @glyphjs/compiler, and returns
 * diagnostics for any that fail schema validation. Used by the prompt handler
 * to auto-repair broken blocks.
 */

import { compile } from '@glyphjs/compiler';

// ─── Types ──────────────────────────────────────────────────────

export interface GlyphBlockMatch {
  language: string;       // e.g. "ui:flowchart"
  content: string;        // YAML body
  fullMatch: string;      // ```ui:flowchart\n...\n```
  startIndex: number;
}

export interface GlyphLintResult {
  /** Blocks that failed validation */
  failures: Array<{
    block: GlyphBlockMatch;
    errors: string[];
  }>;
  /** Total ui: blocks found */
  totalBlocks: number;
}

// ─── Block Extraction ──────────────────────────────────────────

const UI_BLOCK_REGEX = /```(ui:\w+)\n([\s\S]*?)```/g;

export function extractGlyphBlocks(text: string): GlyphBlockMatch[] {
  const blocks: GlyphBlockMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  UI_BLOCK_REGEX.lastIndex = 0;

  while ((match = UI_BLOCK_REGEX.exec(text)) !== null) {
    blocks.push({
      language: match[1],
      content: match[2].trimEnd(),
      fullMatch: match[0],
      startIndex: match.index,
    });
  }

  return blocks;
}

// ─── Lint ──────────────────────────────────────────────────────

export function lintGlyphBlocks(text: string): GlyphLintResult {
  const blocks = extractGlyphBlocks(text);

  if (blocks.length === 0) {
    return { failures: [], totalBlocks: 0 };
  }

  const failures: GlyphLintResult['failures'] = [];

  for (const block of blocks) {
    try {
      const markdown = '```' + block.language + '\n' + block.content + '\n```';
      const result = compile(markdown);

      if (result.hasErrors && result.diagnostics.length > 0) {
        failures.push({
          block,
          errors: result.diagnostics.map((d: any) =>
            d.message ?? d.toString?.() ?? JSON.stringify(d),
          ),
        });
      }
    } catch (err) {
      failures.push({
        block,
        errors: [`Compilation error: ${(err as Error).message}`],
      });
    }
  }

  return { failures, totalBlocks: blocks.length };
}

// ─── Repair Prompt Builder ─────────────────────────────────────

export function buildRepairPrompt(failures: GlyphLintResult['failures']): string {
  const parts = failures.map(({ block, errors }) => {
    const errorList = errors.map((e) => `  - ${e}`).join('\n');
    return [
      `Your \`${block.language}\` block failed schema validation:`,
      errorList,
      '',
      'Original block:',
      '```' + block.language,
      block.content,
      '```',
    ].join('\n');
  });

  return [
    'Some of your GlyphJS ui: blocks have validation errors. Please fix them.',
    '',
    ...parts,
    '',
    'Respond with ONLY the corrected fenced code blocks (one per failure), nothing else.',
  ].join('\n');
}

// ─── Response Patcher ──────────────────────────────────────────

/**
 * Replaces failed ui: blocks in the original response with repaired versions
 * extracted from the repair response.
 */
export function patchResponse(
  original: string,
  failures: GlyphLintResult['failures'],
  repairResponse: string,
): string {
  const repairedBlocks = extractGlyphBlocks(repairResponse);
  let patched = original;

  for (const failure of failures) {
    // Find a repaired block with matching language
    const repair = repairedBlocks.find((r) => r.language === failure.block.language);
    if (repair) {
      patched = patched.replace(failure.block.fullMatch, repair.fullMatch);
    }
  }

  return patched;
}
