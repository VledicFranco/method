/**
 * Router SLM Evaluation
 *
 * Binary classification: "flat" or "unified-memory"
 * Gate 1: Parse rate (output is one of the two valid labels)
 * Gate 2: Accuracy >= 83% (5/6 on task suite)
 *
 * Usage:
 *   node evaluate-router.mjs <predictions.jsonl>
 *   node evaluate-router.mjs --corpus-check
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_LABELS = new Set(['flat', 'unified-memory']);

function evaluate(entries) {
  let parseOk = 0;
  let correct = 0;
  let total = entries.length;
  const confusion = { flat_flat: 0, flat_um: 0, um_flat: 0, um_um: 0 };

  for (const entry of entries) {
    const expected = entry.expected?.trim();
    const raw = (entry.predicted || '').trim();

    // Extract first valid label from output
    let predicted;
    if (raw.startsWith('flat')) predicted = 'flat';
    else if (raw.startsWith('unified-memory')) predicted = 'unified-memory';
    else predicted = raw.split(/\s/)[0]; // take first word

    if (VALID_LABELS.has(predicted)) {
      parseOk++;
      if (predicted === expected) {
        correct++;
        if (expected === 'flat') confusion.flat_flat++;
        else confusion.um_um++;
      } else {
        if (expected === 'flat') confusion.flat_um++;
        else confusion.um_flat++;
      }
    }
  }

  const parseRate = parseOk / total;
  const accuracy = correct / total;

  return { total, parseOk, parseRate, correct, accuracy, confusion };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--corpus-check')) {
    const holdoutPath = resolve(__dirname, '../corpus/holdout.jsonl');
    const lines = readFileSync(holdoutPath, 'utf-8').trim().split('\n');
    const entries = lines.map(l => {
      const d = JSON.parse(l);
      return { expected: d.output, predicted: d.output };
    });
    const r = evaluate(entries);
    console.log(`Corpus check: ${r.parseOk}/${r.total} valid labels (${(r.parseRate*100).toFixed(1)}%)`);
    process.exit(r.parseRate === 1 ? 0 : 1);
  }

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node evaluate-router.mjs <predictions.jsonl>');
    console.log('  node evaluate-router.mjs --corpus-check');
    process.exit(1);
  }

  const lines = readFileSync(args[0], 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));
  const r = evaluate(entries);

  console.log(`\n=== Router SLM Evaluation ===`);
  console.log(`Total:     ${r.total}`);
  console.log(`Parse OK:  ${r.parseOk} (${(r.parseRate*100).toFixed(1)}%)`);
  console.log(`Correct:   ${r.correct} (${(r.accuracy*100).toFixed(1)}%)`);
  console.log(`\nConfusion Matrix:`);
  console.log(`                 Predicted`);
  console.log(`               flat    unified`);
  console.log(`  Actual flat    ${r.confusion.flat_flat}      ${r.confusion.flat_um}`);
  console.log(`  Actual unified ${r.confusion.um_flat}      ${r.confusion.um_um}`);
  console.log(`\nGate 1 (parse 100%): ${r.parseRate === 1 ? 'PASS' : 'FAIL'}`);
  console.log(`Gate 2 (accuracy >= 83%): ${r.accuracy >= 0.83 ? 'PASS' : 'FAIL'}`);

  process.exit(r.accuracy >= 0.83 ? 0 : 1);
}

main();
