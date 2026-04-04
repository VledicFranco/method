/**
 * Gate A-G2: Downstream SLM Validation
 *
 * Proves that a B-1-generated grammar is usable as a training target:
 * 1. Takes B-1's generated grammar for WorktreeInfo
 * 2. Compiles it with Peggy (sanity check)
 * 3. Generates a training corpus: random context → DSL output
 * 4. Validates all corpus entries parse correctly
 * 5. Outputs corpus for downstream SLM training
 *
 * After training, run: node gate-ag2.mjs --evaluate <predictions.jsonl>
 *
 * Usage:
 *   node gate-ag2.mjs --generate     Generate corpus (1K train + 250 holdout)
 *   node gate-ag2.mjs --evaluate <f> Evaluate downstream SLM predictions
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../results');
const CORPUS_DIR = resolve(__dirname, '../corpus');

// ── B-1 generated grammar for WorktreeInfo ────────────────────

// Read from real-predictions.jsonl
const realPreds = readFileSync(resolve(RESULTS_DIR, 'real-predictions.jsonl'), 'utf-8')
  .trim().split('\n').map(l => JSON.parse(l));
const worktreeGrammar = realPreds.find(p => p.id === 'worktree-info').predicted;

// ── Helpers ───────────────────────────────────────────────────

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBranch() {
  const prefixes = ['feat', 'fix', 'chore', 'refactor', 'test', 'research'];
  const slugs = ['auth-flow', 'slm-training', 'api-v2', 'config-migration',
    'event-bus', 'cluster-sync', 'workspace-eviction', 'gate-ui',
    'token-tracking', 'federation-relay', 'prd-044', 'rfc-005'];
  return `${randomChoice(prefixes)}/${randomChoice(slugs)}`;
}

function randomPath() {
  const bases = ['/tmp/worktrees', '/c/Users/dev/repos', '/home/agent/work'];
  return `${randomChoice(bases)}/${randomBranch().replace('/', '-')}`;
}

// ── Corpus generation ─────────────────────────────────────────

function generateWorktreeEntry() {
  const isolation = randomChoice(['shared', 'worktree']);
  const hasWorktree = isolation === 'worktree' && Math.random() > 0.2;
  const path = hasWorktree ? randomPath() : null;
  const branch = hasWorktree ? randomBranch() : null;
  const metals = Math.random() > 0.3;

  // Build DSL output (what the downstream SLM should produce)
  const lines = [];
  lines.push(`ISOLATION: ${isolation}`);
  lines.push(`WORKTREE_PATH: ${path ? `"${path}"` : 'none'}`);
  lines.push(`WORKTREE_BRANCH: ${branch ? `"${branch}"` : 'none'}`);
  lines.push(`METALS_AVAILABLE: ${metals ? 'yes' : 'no'}`);
  const dslOutput = lines.join('\n');

  // Build input context (what triggers the downstream SLM)
  const inputLines = [];
  inputLines.push('SESSION-CONTEXT:');
  inputLines.push(`  isolation_mode=${isolation}`);
  if (hasWorktree) {
    inputLines.push(`  worktree_active=True`);
    inputLines.push(`  worktree_path=${path}`);
    inputLines.push(`  branch=${branch}`);
  } else {
    inputLines.push(`  worktree_active=False`);
  }
  inputLines.push(`  metals_check=${metals ? 'passed' : 'failed'}`);
  const input = inputLines.join('\n');

  return { input, output: dslOutput };
}

// ── Generate mode ─────────────────────────────────────────────

function generate() {
  console.log('Compiling B-1 generated grammar...');
  let parser;
  try {
    parser = peggy.generate(worktreeGrammar);
    console.log('  Grammar compiles OK\n');
  } catch (e) {
    console.log('  FAIL:', e.message);
    process.exit(1);
  }

  const TARGET_TRAIN = 1000;
  const TARGET_HOLDOUT = 250;
  const total = TARGET_TRAIN + TARGET_HOLDOUT;

  console.log(`Generating ${total} corpus entries...`);

  const corpus = [];
  let parseOk = 0;
  let parseFail = 0;

  for (let i = 0; i < total; i++) {
    const entry = generateWorktreeEntry();

    // Validate: does the DSL output parse with B-1's grammar?
    try {
      parser.parse(entry.output);
      parseOk++;
    } catch (e) {
      parseFail++;
      if (parseFail <= 3) {
        console.log(`  Parse fail: ${e.message?.slice(0, 100)}`);
        console.log(`  Output was: ${entry.output}`);
      }
      continue;
    }

    corpus.push(entry);
  }

  console.log(`\nGenerated: ${corpus.length} valid, ${parseFail} failed parse`);
  console.log(`Parse validation: ${parseOk}/${parseOk + parseFail} (${(parseOk / (parseOk + parseFail) * 100).toFixed(1)}%)`);

  // Split
  const train = corpus.slice(0, TARGET_TRAIN);
  const holdout = corpus.slice(TARGET_TRAIN, TARGET_TRAIN + TARGET_HOLDOUT);

  // Write
  const ag2Dir = resolve(CORPUS_DIR, 'ag2-worktree');
  try { mkdirSync(ag2Dir, { recursive: true }); } catch {}

  writeFileSync(
    resolve(ag2Dir, 'train.jsonl'),
    train.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
  writeFileSync(
    resolve(ag2Dir, 'holdout.jsonl'),
    holdout.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Also save the grammar for reference
  writeFileSync(resolve(ag2Dir, 'grammar.peggy'), worktreeGrammar);

  console.log(`\nWrote ${train.length} train + ${holdout.length} holdout to ${ag2Dir}/`);
  console.log('Grammar saved to grammar.peggy');
}

// ── Evaluate mode ─────────────────────────────────────────────

function evaluate(predPath) {
  console.log('Compiling B-1 generated grammar...');
  const parser = peggy.generate(worktreeGrammar);
  console.log('  Grammar compiles OK\n');

  const lines = readFileSync(predPath, 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));

  console.log(`Evaluating ${entries.length} predictions...\n`);

  let parseOk = 0;
  let parseFail = 0;
  let semanticMatch = 0;
  const errors = [];

  for (const entry of entries) {
    const predicted = entry.predicted || entry.output;

    // Parse check
    try {
      const result = parser.parse(predicted);
      parseOk++;

      // Semantic check: if we have expected, compare parsed objects
      if (entry.expected) {
        try {
          const expectedResult = parser.parse(entry.expected);
          if (JSON.stringify(result) === JSON.stringify(expectedResult)) {
            semanticMatch++;
          }
        } catch {}
      }
    } catch (e) {
      parseFail++;
      if (errors.length < 5) {
        errors.push({
          input: entry.input?.slice(0, 60),
          error: e.message?.slice(0, 150),
          predicted: predicted?.slice(0, 100),
        });
      }
    }
  }

  const parseAccuracy = parseOk / entries.length;
  const semanticAccuracy = entry => entry.expected ? semanticMatch / entries.length : null;
  const gatePass = parseAccuracy >= 0.85;

  console.log(`Parse accuracy:     ${parseOk}/${entries.length} (${(parseAccuracy * 100).toFixed(1)}%)`);
  console.log(`Semantic match:     ${semanticMatch}/${entries.length} (${(semanticMatch / entries.length * 100).toFixed(1)}%)`);
  console.log(`\nGate A-G2 (>= 85%): ${gatePass ? 'PASS' : 'FAIL'}`);

  if (errors.length > 0) {
    console.log(`\nFirst ${errors.length} parse errors:`);
    for (const e of errors) {
      console.log(`  Input: ${e.input}...`);
      console.log(`  Predicted: ${e.predicted}...`);
      console.log(`  Error: ${e.error}\n`);
    }
  }

  process.exit(gatePass ? 0 : 1);
}

// ── Main ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--generate')) {
  generate();
} else if (args.includes('--evaluate')) {
  const idx = args.indexOf('--evaluate');
  const predPath = args[idx + 1];
  if (!predPath) {
    console.log('Usage: node gate-ag2.mjs --evaluate <predictions.jsonl>');
    process.exit(1);
  }
  evaluate(predPath);
} else {
  console.log('Usage:');
  console.log('  node gate-ag2.mjs --generate              Generate downstream corpus');
  console.log('  node gate-ag2.mjs --evaluate <pred.jsonl>  Evaluate downstream predictions');
  process.exit(1);
}
