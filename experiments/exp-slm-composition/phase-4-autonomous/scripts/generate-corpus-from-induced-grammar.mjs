/**
 * Generate a training corpus using a grammar induced by the DSL Inducer.
 *
 * This is the final step in the autonomous compilation loop:
 * 1. Traces → DSL Inducer → induced grammar (done)
 * 2. Auto-refine → parseable grammar (done)
 * 3. **Use grammar to validate synthetic corpus entries** (this script)
 * 4. Train SLM on validated corpus
 *
 * Takes source traces + induced grammar, generates training pairs by
 * sampling real (input, output) traces and validating each output
 * parses through the induced grammar.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def;
  };

  const grammarPath = getArg('--grammar', null);
  const tracesPath = getArg('--traces', null);
  const outDir = getArg('--out-dir', null);
  const target = parseInt(getArg('--target', '2000'));

  if (!grammarPath || !tracesPath || !outDir) {
    console.log('Usage: node generate-corpus-from-induced-grammar.mjs --grammar <g.peggy> --traces <t.jsonl> --out-dir <dir> [--target N]');
    process.exit(1);
  }

  // Load induced grammar
  console.log(`Loading induced grammar from ${grammarPath}`);
  const grammarText = readFileSync(grammarPath, 'utf-8');
  const parser = peggy.generate(grammarText);
  console.log('✓ Grammar compiles');

  // Load source traces
  console.log(`Loading traces from ${tracesPath}`);
  const traces = readFileSync(tracesPath, 'utf-8').trim().split('\n')
    .map(l => JSON.parse(l));
  console.log(`  ${traces.length} source traces`);

  // Validate each trace through the induced grammar, build corpus
  const corpus = [];
  let pass = 0, fail = 0;
  for (const t of traces) {
    try {
      parser.parse(t.output);
      corpus.push({ input: t.input, output: t.output });
      pass++;
    } catch {
      fail++;
    }
  }
  console.log(`  ${pass} traces pass induced grammar / ${fail} fail`);

  // Shuffle and sample to target size
  const shuffled = shuffle(corpus);
  const sampled = shuffled.slice(0, target);

  // 80/20 split
  const splitIdx = Math.floor(sampled.length * 0.8);
  const train = sampled.slice(0, splitIdx);
  const holdout = sampled.slice(splitIdx);

  // Write
  try { mkdirSync(outDir, { recursive: true }); } catch {}

  writeFileSync(
    resolve(outDir, 'train.jsonl'),
    train.map(e => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(
    resolve(outDir, 'holdout.jsonl'),
    holdout.map(e => JSON.stringify(e)).join('\n') + '\n',
  );

  console.log(`\nWrote ${train.length} train + ${holdout.length} holdout to ${outDir}/`);
  console.log(`\nThis corpus was entirely validated by an autonomously induced grammar.`);
  console.log(`Train an SLM on it to close the autonomous compilation loop.`);
}

main();
