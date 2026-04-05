/**
 * B-2 Causal Validator Corpus Generator
 *
 * Takes existing SLM training corpora and generates (input, output) → VALID/INVALID
 * classification pairs. B-2 learns to detect when an output doesn't causally
 * match its input — automating corpus quality validation.
 *
 * Corruption strategies for INVALID examples:
 *   1. Cross-entry swap: output from entry A paired with input from entry B
 *   2. Field value corruption: change specific values while keeping structure
 *   3. Missing causal consequence: remove expected output for a given input signal
 *   4. Spurious addition: add anomalies/fields that input doesn't justify
 *
 * Usage: node experiments/exp-slm-composition/phase-2-bootstrap/scripts/generate-b2-corpus.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../corpus');

// ── Helpers ──────────────────────────────────────────────────

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadJsonl(path) {
  try {
    return readFileSync(path, 'utf-8').trim().split('\n')
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));
  } catch {
    console.log(`  Warning: could not load ${path}`);
    return [];
  }
}

// ── Format a B-2 entry ───────────────────────────────────────

function formatB2Entry(domain, inputText, outputText) {
  return `DOMAIN: ${domain}\nINPUT:\n${inputText}\nOUTPUT:\n${outputText}`;
}

// ── Monitor domain corruptions ───────────────────────────────

function corruptMonitorOutput(output) {
  const strategy = randomInt(0, 4);

  switch (strategy) {
    case 0: {
      // Flip REPLAN value
      if (output.includes('REPLAN: no')) return output.replace('REPLAN: no', 'REPLAN: yes');
      if (output.includes('REPLAN: yes')) return output.replace('REPLAN: yes', 'REPLAN: no');
      return output.replace('ANOMALIES: none', 'ANOMALIES:\n@reasoner low-confidence "Spurious anomaly"');
    }
    case 1: {
      // Remove anomaly that should be present (if any)
      const lines = output.split('\n');
      const anomalyLines = lines.filter(l => l.startsWith('@'));
      if (anomalyLines.length > 0) {
        // Remove the first anomaly
        const idx = lines.indexOf(anomalyLines[0]);
        lines.splice(idx, 1);
        // If no anomalies left, replace ANOMALIES section
        if (anomalyLines.length === 1) {
          const headerIdx = lines.findIndex(l => l.startsWith('ANOMALIES:'));
          if (headerIdx >= 0) lines[headerIdx] = 'ANOMALIES: none';
        }
        return lines.join('\n');
      }
      // No anomalies to remove — add a spurious one
      return output.replace('ANOMALIES: none', 'ANOMALIES:\n@actor unexpected-result "Fabricated error"');
    }
    case 2: {
      // Add spurious RESTRICT
      if (output.includes('RESTRICT: none')) {
        return output.replace('RESTRICT: none', 'RESTRICT: Read, Edit, Write');
      }
      return output.replace(/RESTRICT: .+/, 'RESTRICT: none');
    }
    case 3: {
      // Add spurious ESCALATE
      if (output.includes('ESCALATE: none')) {
        return output.replace('ESCALATE: none', 'ESCALATE: "System critically compromised"');
      }
      return output.replace(/ESCALATE: .+/, 'ESCALATE: none');
    }
    case 4: {
      // Swap anomaly type
      return output
        .replace('low-confidence', 'unexpected-result')
        .replace('unexpected-result', 'compound');
    }
  }
  return output;
}

// ── WorktreeInfo domain corruptions ──────────────────────────

function corruptWorktreeOutput(output) {
  const strategy = randomInt(0, 3);

  switch (strategy) {
    case 0: {
      // Flip isolation mode
      if (output.includes('ISOLATION: shared')) return output.replace('ISOLATION: shared', 'ISOLATION: worktree');
      return output.replace('ISOLATION: worktree', 'ISOLATION: shared');
    }
    case 1: {
      // Flip metals
      if (output.includes('METALS_AVAILABLE: yes')) return output.replace('METALS_AVAILABLE: yes', 'METALS_AVAILABLE: no');
      return output.replace('METALS_AVAILABLE: no', 'METALS_AVAILABLE: yes');
    }
    case 2: {
      // Add path to shared (shouldn't have one)
      if (output.includes('WORKTREE_PATH: none')) {
        return output.replace('WORKTREE_PATH: none', 'WORKTREE_PATH: "/fake/path"');
      }
      return output.replace(/WORKTREE_PATH: ".+"/, 'WORKTREE_PATH: none');
    }
    case 3: {
      // Swap branch
      if (output.includes('WORKTREE_BRANCH: none')) {
        return output.replace('WORKTREE_BRANCH: none', 'WORKTREE_BRANCH: "feat/wrong-branch"');
      }
      return output.replace(/WORKTREE_BRANCH: ".+"/, 'WORKTREE_BRANCH: none');
    }
  }
  return output;
}

// ── Schema→Grammar domain corruptions ────────────────────────

function corruptSchemaGrammarOutput(output) {
  const strategy = randomInt(0, 3);

  switch (strategy) {
    case 0: {
      // Wrong type mapping: QuotedString → Float
      return output.replace(/v:QuotedString/, 'v:Float');
    }
    case 1: {
      // Wrong type mapping: Bool → QuotedString
      return output.replace(/v:Bool/, 'v:QuotedString');
    }
    case 2: {
      // Change required to optional (add Opt suffix)
      const match = output.match(/^(\w+Section)\n/m);
      if (match) {
        return output.replace(match[1], match[1].replace('Section', 'Opt'));
      }
      return output.replace(/v:Float/, 'v:Integer');
    }
    case 3: {
      // Swap enum values
      return output.replace(/"yes" \{ return true; \}/, '"true" { return true; }');
    }
  }
  return output;
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  const EXP_SLM = resolve(__dirname, '../../../exp-slm');
  const COMPOSITION = resolve(__dirname, '../../phase-1-schema-grammar');

  console.log('Loading corpora...');

  // Load from multiple domains
  const monitorTrain = loadJsonl(resolve(EXP_SLM, 'phase-2-dsl/corpus/monitor-v2/train.jsonl'));
  const monitorAug = loadJsonl(resolve(EXP_SLM, 'phase-2-dsl/corpus/monitor-v2/train-augmented.jsonl'));
  const worktreeTrain = loadJsonl(resolve(COMPOSITION, 'corpus/ag2-worktree/train.jsonl'));
  const schemaTrain = loadJsonl(resolve(COMPOSITION, 'corpus/train.jsonl'));

  console.log(`  Monitor: ${monitorTrain.length} base + ${monitorAug.length} augmented`);
  console.log(`  WorktreeInfo: ${worktreeTrain.length}`);
  console.log(`  Schema→Grammar: ${schemaTrain.length}`);

  const corpus = [];

  // ── Generate VALID examples ─────────────────────────────────

  // Monitor domain — sample to keep balanced
  const monitorAll = shuffle([...monitorTrain, ...monitorAug]).slice(0, 2000);
  for (const entry of monitorAll) {
    corpus.push({
      input: formatB2Entry('monitor', entry.input, entry.output),
      output: 'VALID',
    });
  }
  console.log(`  Added ${monitorAll.length} VALID monitor entries`);

  // WorktreeInfo domain
  for (const entry of worktreeTrain) {
    corpus.push({
      input: formatB2Entry('worktree', entry.input, entry.output),
      output: 'VALID',
    });
  }
  console.log(`  Added ${worktreeTrain.length} VALID worktree entries`);

  // Schema→Grammar domain — sample
  const schemaSubset = shuffle([...schemaTrain]).slice(0, 1000);
  for (const entry of schemaSubset) {
    corpus.push({
      input: formatB2Entry('schema-grammar', entry.input, entry.output),
      output: 'VALID',
    });
  }
  console.log(`  Added ${schemaSubset.length} VALID schema-grammar entries`);

  const validCount = corpus.length;

  // ── Generate INVALID examples (same count as VALID) ─────────

  // Monitor corruptions
  for (const entry of shuffle([...monitorAll]).slice(0, monitorAll.length)) {
    const corrupted = corruptMonitorOutput(entry.output);
    if (corrupted !== entry.output) {
      corpus.push({
        input: formatB2Entry('monitor', entry.input, corrupted),
        output: 'INVALID',
      });
    }
  }

  // Monitor cross-entry swaps
  const monitorShuffled = shuffle([...monitorAll]);
  for (let i = 0; i < Math.min(500, monitorShuffled.length - 1); i++) {
    corpus.push({
      input: formatB2Entry('monitor', monitorShuffled[i].input, monitorShuffled[i + 1].output),
      output: 'INVALID',
    });
  }

  // WorktreeInfo corruptions
  for (const entry of worktreeTrain) {
    const corrupted = corruptWorktreeOutput(entry.output);
    if (corrupted !== entry.output) {
      corpus.push({
        input: formatB2Entry('worktree', entry.input, corrupted),
        output: 'INVALID',
      });
    }
  }

  // WorktreeInfo cross-entry swaps
  const worktreeShuffled = shuffle([...worktreeTrain]);
  for (let i = 0; i < Math.min(300, worktreeShuffled.length - 1); i++) {
    corpus.push({
      input: formatB2Entry('worktree', worktreeShuffled[i].input, worktreeShuffled[i + 1].output),
      output: 'INVALID',
    });
  }

  // Schema→Grammar corruptions
  for (const entry of schemaSubset) {
    const corrupted = corruptSchemaGrammarOutput(entry.output);
    if (corrupted !== entry.output) {
      corpus.push({
        input: formatB2Entry('schema-grammar', entry.input, corrupted),
        output: 'INVALID',
      });
    }
  }

  // Schema→Grammar cross-entry swaps
  const schemaShuffled = shuffle([...schemaSubset]);
  for (let i = 0; i < Math.min(300, schemaShuffled.length - 1); i++) {
    corpus.push({
      input: formatB2Entry('schema-grammar', schemaShuffled[i].input, schemaShuffled[i + 1].output),
      output: 'INVALID',
    });
  }

  const invalidCount = corpus.length - validCount;
  console.log(`\n  VALID: ${validCount}, INVALID: ${invalidCount}`);
  console.log(`  Total: ${corpus.length}`);
  console.log(`  Balance: ${(validCount / corpus.length * 100).toFixed(1)}% valid / ${(invalidCount / corpus.length * 100).toFixed(1)}% invalid`);

  // Shuffle and split
  const shuffled = shuffle(corpus);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, splitIdx);
  const holdout = shuffled.slice(splitIdx);

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
}

main();
