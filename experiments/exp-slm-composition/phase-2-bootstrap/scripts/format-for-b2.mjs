/**
 * Format a corpus of (input, output) pairs into B-2 input format.
 *
 * Usage:
 *   node format-for-b2.mjs <domain> <input.jsonl> <output.jsonl>
 *
 * Example:
 *   node format-for-b2.mjs kpi-checker ../kpi-checker/corpus/holdout.jsonl ../kpi-checker/corpus/b2-input.jsonl
 */

import { readFileSync, writeFileSync } from 'node:fs';

function main() {
  const [, , domain, inputPath, outputPath] = process.argv;

  if (!domain || !inputPath || !outputPath) {
    console.log('Usage: node format-for-b2.mjs <domain> <input.jsonl> <output.jsonl>');
    process.exit(1);
  }

  const lines = readFileSync(inputPath, 'utf-8').trim().split('\n');
  const formatted = lines.map(line => {
    const entry = JSON.parse(line);
    return {
      input: `DOMAIN: ${domain}\nINPUT:\n${entry.input}\nOUTPUT:\n${entry.output}`,
      output: 'VALID', // expected label (we'll see if B-2 agrees)
    };
  });

  writeFileSync(outputPath, formatted.map(e => JSON.stringify(e)).join('\n') + '\n');
  console.log(`Formatted ${formatted.length} entries from ${inputPath} → ${outputPath}`);
}

main();
