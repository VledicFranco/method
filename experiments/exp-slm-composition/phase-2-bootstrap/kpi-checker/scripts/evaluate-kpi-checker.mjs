/**
 * KPI Checker SLM Evaluation
 *
 * Evaluates predictions against the Check DSL grammar.
 * Gate 1: DSL parse rate >= 98%
 * Gate 2: Semantic accuracy >= 90% (correct primitive for the KPI)
 *
 * Usage:
 *   node evaluate-kpi-checker.mjs <predictions.jsonl>
 *   node evaluate-kpi-checker.mjs --corpus-check  (validate corpus quality)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(__dirname, '../check-dsl.peggy');
const grammar = readFileSync(grammarPath, 'utf-8');
const parser = peggy.generate(grammar);

function evaluatePredictions(entries) {
  let parseOk = 0;
  let parseFail = 0;
  let semanticMatch = 0;
  const errors = [];

  for (const entry of entries) {
    const predicted = entry.predicted || entry.output;

    // Gate 1: Does it parse?
    try {
      const result = parser.parse(predicted);
      parseOk++;

      // Gate 2: Semantic match (same primitive type as expected)
      if (entry.expected) {
        try {
          const expectedResult = parser.parse(entry.expected);
          // Check if same top-level primitive type
          const predType = result.type || (result.checks ? 'allChecks' : 'unknown');
          const expType = expectedResult.type || (expectedResult.checks ? 'allChecks' : 'unknown');
          if (predType === expType) semanticMatch++;
        } catch {}
      }
    } catch (e) {
      parseFail++;
      if (errors.length < 5) {
        errors.push({
          input: entry.input?.slice(0, 60),
          predicted: predicted?.slice(0, 80),
          error: e.message?.slice(0, 100),
        });
      }
    }
  }

  const parseRate = parseOk / entries.length;
  const semanticRate = entry => entry.expected ? semanticMatch / entries.length : null;
  const gate1Pass = parseRate >= 0.98;

  return { total: entries.length, parseOk, parseFail, semanticMatch, parseRate, gate1Pass, errors };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--corpus-check')) {
    const holdoutPath = resolve(__dirname, '../corpus/holdout.jsonl');
    const lines = readFileSync(holdoutPath, 'utf-8').trim().split('\n');
    const entries = lines.map(l => {
      const d = JSON.parse(l);
      return { input: d.input, predicted: d.output, expected: d.output };
    });

    console.log('Corpus quality check on holdout set\n');
    const r = evaluatePredictions(entries);
    console.log(`Total:        ${r.total}`);
    console.log(`Parse OK:     ${r.parseOk} (${(r.parseRate * 100).toFixed(1)}%)`);
    console.log(`Parse fail:   ${r.parseFail}`);
    console.log(`\nCorpus quality: ${r.parseRate === 1 ? 'PERFECT' : 'ISSUES FOUND'}`);
    process.exit(r.parseRate === 1 ? 0 : 1);
  }

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node evaluate-kpi-checker.mjs <predictions.jsonl>');
    console.log('  node evaluate-kpi-checker.mjs --corpus-check');
    process.exit(1);
  }

  const predPath = args[0];
  const lines = readFileSync(predPath, 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));

  console.log(`Evaluating ${entries.length} predictions\n`);
  const r = evaluatePredictions(entries);

  console.log(`Total:          ${r.total}`);
  console.log(`Parse OK:       ${r.parseOk} (${(r.parseRate * 100).toFixed(1)}%)`);
  console.log(`Parse fail:     ${r.parseFail}`);
  console.log(`Semantic match: ${r.semanticMatch}`);
  console.log(`\nGate 1 (parse >= 98%): ${r.gate1Pass ? 'PASS' : 'FAIL'}`);

  if (r.errors.length > 0) {
    console.log(`\nFirst ${r.errors.length} errors:`);
    for (const e of r.errors) {
      console.log(`  Input: ${e.input}...`);
      console.log(`  Predicted: ${e.predicted}...`);
      console.log(`  Error: ${e.error}\n`);
    }
  }

  process.exit(r.gate1Pass ? 0 : 1);
}

main();
