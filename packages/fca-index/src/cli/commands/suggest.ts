// SPDX-License-Identifier: Apache-2.0
/**
 * suggest command — generate FCA compliance stubs for a component.
 *
 * Default (no flags): dry-run preview — prints what files would be created.
 * --apply: writes the stub files to disk.
 * --json: prints ComplianceSuggestion as JSON instead of human-readable format.
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ComplianceSuggestionPort, ComplianceSuggestionRequest } from '../../ports/compliance-suggestion.js';
import { ComplianceSuggestionError } from '../../ports/compliance-suggestion.js';

export interface SuggestCommandOptions {
  apply?: boolean;
  json?: boolean;
}

export async function runSuggestCommand(
  suggestPort: ComplianceSuggestionPort,
  request: ComplianceSuggestionRequest,
  options: SuggestCommandOptions = {},
): Promise<void> {
  let suggestion;
  try {
    suggestion = await suggestPort.suggest(request);
  } catch (err) {
    if (err instanceof ComplianceSuggestionError) {
      if (err.code === 'NOT_FOUND' || err.code === 'INDEX_NOT_FOUND') {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
    }
    throw err;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(suggestion, null, 2) + '\n');
    return;
  }

  if (suggestion.missingParts.length === 0) {
    process.stdout.write(
      `Component '${suggestion.componentPath}' is fully documented (score: ${suggestion.currentScore.toFixed(2)}).\n` +
        'No compliance stubs needed.\n',
    );
    return;
  }

  // Human-readable output: show current score and each stub.
  process.stdout.write(
    `Component: ${suggestion.componentPath}\n` +
      `Current coverage score: ${suggestion.currentScore.toFixed(2)}\n` +
      `Missing parts: ${suggestion.missingParts.length}\n\n`,
  );

  const componentDir = resolve(request.projectRoot, suggestion.componentPath);

  for (const stub of suggestion.missingParts) {
    const filePath = resolve(componentDir, stub.suggestedFile);
    const relFilePath = `${suggestion.componentPath}/${stub.suggestedFile}`;

    process.stdout.write(`── [${stub.part}] → ${relFilePath}\n`);
    process.stdout.write('```\n');
    process.stdout.write(stub.templateContent);
    process.stdout.write('```\n\n');

    if (options.apply) {
      await writeStub(filePath, stub.templateContent);
      process.stdout.write(`   ✓ written: ${relFilePath}\n\n`);
    }
  }

  if (!options.apply) {
    process.stdout.write(
      `Run with --apply to write ${suggestion.missingParts.length} stub file(s) to disk.\n`,
    );
  } else {
    process.stdout.write(
      `Applied ${suggestion.missingParts.length} stub file(s). ` +
        `Run 'fca-index scan <projectRoot>' to update coverage.\n`,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write stub content to a file. Creates parent directories as needed.
 * Does NOT overwrite files that already exist — stubs are additive.
 */
async function writeStub(filePath: string, content: string): Promise<void> {
  // Check if file already exists — do not overwrite.
  try {
    await access(filePath);
    // File exists — skip
    return;
  } catch {
    // File does not exist — safe to create.
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
