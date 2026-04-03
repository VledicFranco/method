/**
 * B-1 Schema→Grammar SLM Evaluation
 *
 * Gate A-G1: Do generated grammars compile with Peggy? (Target >= 90%)
 * Gate A-G2: Can the generated grammar parse a synthetic example? (Bonus)
 *
 * Takes a trained model's outputs and evaluates them against the holdout set.
 * Since we can't run inference from Node.js, this script evaluates pre-generated
 * predictions from the Python evaluate.py output.
 *
 * Usage:
 *   1. Run Python evaluation to generate predictions:
 *      python evaluate.py --config <config> --model-dir <model>
 *   2. Run this script on the predictions:
 *      node evaluate-b1.mjs <predictions.jsonl>
 *
 * Or run standalone on holdout to validate corpus quality:
 *   node evaluate-b1.mjs --corpus-check
 *
 * Predictions JSONL format (one per line):
 *   {"input": "interface ...", "expected": "grammar...", "predicted": "grammar..."}
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Grammar compilation test ──────────────────────────────────

function testGrammarCompiles(grammar) {
  try {
    peggy.generate(grammar);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 200) };
  }
}

// ── Grammar structural comparison ─────────────────────────────

function extractRuleNames(grammar) {
  const rules = new Set();
  for (const line of grammar.split('\n')) {
    const match = line.match(/^([A-Z][a-zA-Z0-9]*(?:Section|Opt|Value)?)\s*$/);
    if (match) rules.add(match[1]);
  }
  return rules;
}

function countSections(grammar) {
  const required = (grammar.match(/Section\b/g) || []).length;
  const optional = (grammar.match(/Opt\b/g) || []).length;
  return { required, optional };
}

// ── Evaluate predictions ──────────────────────────────────────

function evaluatePredictions(entries) {
  const results = {
    total: entries.length,
    compilable: 0,
    parseError: 0,
    structuralMatch: 0,
    errors: [],
  };

  for (const entry of entries) {
    const grammar = entry.predicted || entry.output;

    // Gate A-G1: Does the grammar compile?
    const compileResult = testGrammarCompiles(grammar);
    if (compileResult.ok) {
      results.compilable++;
    } else {
      results.parseError++;
      if (results.errors.length < 10) {
        results.errors.push({
          input: entry.input?.slice(0, 80),
          error: compileResult.error,
        });
      }
    }

    // Structural similarity (if we have expected)
    if (entry.expected && compileResult.ok) {
      const expectedSections = countSections(entry.expected);
      const predictedSections = countSections(grammar);
      if (
        expectedSections.required === predictedSections.required &&
        expectedSections.optional === predictedSections.optional
      ) {
        results.structuralMatch++;
      }
    }
  }

  const compilability = results.compilable / results.total;
  const gatePass = compilability >= 0.9;

  return {
    ...results,
    compilability,
    gateAG1: gatePass ? 'PASS' : 'FAIL',
    structuralMatchRate: results.structuralMatch / results.total,
  };
}

// ── Corpus quality check ──────────────────────────────────────

function corpusCheck() {
  const holdoutPath = resolve(__dirname, '../corpus/holdout.jsonl');
  const lines = readFileSync(holdoutPath, 'utf-8').trim().split('\n');
  const entries = lines.map(l => {
    const d = JSON.parse(l);
    return { input: d.input, predicted: d.output, expected: d.output };
  });

  console.log('Corpus quality check on holdout set\n');
  const results = evaluatePredictions(entries);
  printResults(results);
}

// ── Print results ─────────────────────────────────────────────

function printResults(results) {
  console.log(`Total entries:      ${results.total}`);
  console.log(`Compilable:         ${results.compilable} (${(results.compilability * 100).toFixed(1)}%)`);
  console.log(`Parse errors:       ${results.parseError}`);
  console.log(`Structural match:   ${results.structuralMatch} (${(results.structuralMatchRate * 100).toFixed(1)}%)`);
  console.log(`\nGate A-G1 (>= 90%): ${results.gateAG1}`);

  if (results.errors.length > 0) {
    console.log(`\nFirst ${results.errors.length} errors:`);
    for (const e of results.errors) {
      console.log(`  ${e.input}...`);
      console.log(`    ${e.error}\n`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--corpus-check')) {
    corpusCheck();
    return;
  }

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node evaluate-b1.mjs <predictions.jsonl>   Evaluate model predictions');
    console.log('  node evaluate-b1.mjs --corpus-check        Verify holdout corpus quality');
    process.exit(1);
  }

  const predPath = args[0];
  const lines = readFileSync(predPath, 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));

  console.log(`Evaluating ${entries.length} predictions from ${predPath}\n`);
  const results = evaluatePredictions(entries);
  printResults(results);

  process.exit(results.gateAG1 === 'PASS' ? 0 : 1);
}

main();
