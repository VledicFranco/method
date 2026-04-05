/**
 * B-2 Causal Validator Evaluation
 *
 * Gate B-G1: Causal detection precision >= 90% on known-bad pairs
 *
 * Takes pre-generated predictions and evaluates classification accuracy.
 * Since B-2 outputs VALID or INVALID, this is a binary classification task.
 *
 * Usage:
 *   1. Generate predictions: python generate-predictions.py --model-dir <b2-model> --holdout <holdout.jsonl> --output <predictions.jsonl>
 *   2. Evaluate: node evaluate-b2.mjs <predictions.jsonl>
 *
 * Predictions JSONL format: {"input": "DOMAIN:...\nINPUT:...\nOUTPUT:...", "expected": "VALID|INVALID", "predicted": "VALID|INVALID..."}
 */

import { readFileSync } from 'node:fs';

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node evaluate-b2.mjs <predictions.jsonl>');
    process.exit(1);
  }

  const lines = readFileSync(args[0], 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));

  let tp = 0;  // true positive: expected INVALID, predicted INVALID
  let tn = 0;  // true negative: expected VALID, predicted VALID
  let fp = 0;  // false positive: expected VALID, predicted INVALID
  let fn = 0;  // false negative: expected INVALID, predicted VALID
  let parseErrors = 0;

  for (const entry of entries) {
    const expected = entry.expected?.trim();
    const predicted = (entry.predicted || '').trim();

    // Classify prediction: starts with VALID or INVALID
    let predLabel;
    if (predicted.startsWith('VALID')) {
      predLabel = 'VALID';
    } else if (predicted.startsWith('INVALID')) {
      predLabel = 'INVALID';
    } else {
      parseErrors++;
      // Treat unparseable as INVALID (conservative)
      predLabel = 'INVALID';
    }

    if (expected === 'VALID' && predLabel === 'VALID') tn++;
    else if (expected === 'VALID' && predLabel === 'INVALID') fp++;
    else if (expected === 'INVALID' && predLabel === 'INVALID') tp++;
    else if (expected === 'INVALID' && predLabel === 'VALID') fn++;
  }

  const total = entries.length;
  const accuracy = (tp + tn) / total;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  // Gate B-G1: precision on INVALID class >= 90%
  const gatePass = precision >= 0.90;

  console.log(`\n=== B-2 Causal Validator Evaluation ===`);
  console.log(`Total entries:     ${total}`);
  console.log(`Parse errors:      ${parseErrors}`);
  console.log(`\nConfusion Matrix:`);
  console.log(`                 Predicted`);
  console.log(`               VALID  INVALID`);
  console.log(`  Actual VALID   ${tn}      ${fp}`);
  console.log(`  Actual INVALID ${fn}      ${tp}`);
  console.log(`\nMetrics:`);
  console.log(`  Accuracy:    ${(accuracy * 100).toFixed(1)}%`);
  console.log(`  Precision:   ${(precision * 100).toFixed(1)}% (INVALID class)`);
  console.log(`  Recall:      ${(recall * 100).toFixed(1)}% (INVALID class)`);
  console.log(`  F1:          ${(f1 * 100).toFixed(1)}%`);
  console.log(`\nGate B-G1 (precision >= 90%): ${gatePass ? 'PASS' : 'FAIL'}`);

  process.exit(gatePass ? 0 : 1);
}

main();
