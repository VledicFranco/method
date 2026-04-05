/**
 * DSL Inducer Prototype — Phase 4 Autonomous Compilation
 *
 * Takes N behavioral traces (input → output pairs) and asks a frontier LLM
 * to abstract a PEG grammar that captures the structural invariant.
 *
 * This tests the core Phase 4 research question: can a frontier LLM
 * produce a formal grammar from behavioral traces?
 *
 * Usage:
 *   node dsl-inducer.mjs --traces <corpus.jsonl> --n 20 --ollama http://chobits:11434
 *   node dsl-inducer.mjs --traces <corpus.jsonl> --n 20 --dry-run  (print prompt only)
 *
 * Output: a PEG grammar (Peggy format) that should parse the traces' outputs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';
import { refineGrammar } from './grammar-refiner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build the induction prompt ───────────────────────────────

function buildPrompt(traces) {
  const examples = traces.map((t, i) => {
    return `--- Example ${i + 1} ---\nINPUT:\n${t.input}\nOUTPUT:\n${t.output}`;
  }).join('\n\n');

  return `You are a PEG grammar induction expert using the Peggy parser generator.

TASK: Given ${traces.length} examples of (input → output) traces, produce a PEG grammar that parses the OUTPUT strings ONLY (ignore the input).

PEGGY SYNTAX REFERENCE:
\`\`\`
// Rules use labeled expressions and return actions:
MyRule
  = label1:SubRule " " label2:SubRule { return { a: label1, b: label2 }; }

// Alternatives use /
Choice = "yes" { return true; } / "no" { return false; }

// Lists use recursion
List = first:Item rest:("," _ item:Item { return item; })* { return [first, ...rest]; }

// Primitives
Identifier = chars:$[a-zA-Z0-9_-]+ { return chars; }
QuotedString = '"' chars:$[^"]* '"' { return chars; }
_ = [ \\t]*
EOL = _ "\\n"
EOLopt = (_ "\\n")?
\`\`\`

RULES:
- Output ONLY valid Peggy grammar. No comments, no explanation.
- Use labeled expressions (label:Rule) NOT this.Rule
- Use $ for text capture (chars:$[a-z]+)
- Grammar must parse every OUTPUT string below (ignore INPUT sections)
- Include semantic actions with { return ...; }
- Lines in the output are separated by \\n

${examples}

Produce ONLY the Peggy grammar that parses the OUTPUT strings above:`;
}

// ── Call Ollama ──────────────────────────────────────────────

async function callOllama(baseUrl, model, prompt) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  console.log(`Calling ${model} at ${endpoint}...`);
  const start = Date.now();

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a PEG grammar expert. Output only valid Peggy grammar code.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.1,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Ollama HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const output = data.choices?.[0]?.message?.content ?? '';
  const latency = Date.now() - start;

  console.log(`Response received (${latency}ms, ${output.length} chars)`);
  return output;
}

// ── Extract grammar from LLM response ────────────────────────

function extractGrammar(response) {
  // Try to find grammar in code blocks
  const codeBlockMatch = response.match(/```(?:peggy|peg|javascript)?\n([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find from first rule definition
  const ruleMatch = response.match(/^([A-Z]\w+\s*\n\s*=[\s\S]+)$/m);
  if (ruleMatch) return ruleMatch[0].trim();

  // Return the whole thing, stripped of markdown
  return response
    .replace(/```\w*/g, '')
    .replace(/```/g, '')
    .trim();
}

// ── Validate grammar ─────────────────────────────────────────

function validateGrammar(grammar, traces) {
  // Step 1: Does it compile?
  let parser;
  try {
    parser = peggy.generate(grammar);
    console.log('✓ Grammar compiles');
  } catch (e) {
    console.log('✗ Grammar compilation FAILED:', e.message?.slice(0, 200));
    return { compiles: false, parseRate: 0, errors: [e.message] };
  }

  // Step 2: Does it parse the trace outputs?
  let pass = 0;
  const errors = [];
  for (let i = 0; i < traces.length; i++) {
    try {
      parser.parse(traces[i].output);
      pass++;
    } catch (e) {
      if (errors.length < 5) {
        errors.push({
          index: i,
          output: traces[i].output.slice(0, 80),
          error: e.message?.slice(0, 100),
        });
      }
    }
  }

  const parseRate = pass / traces.length;
  console.log(`✓ Parse rate: ${pass}/${traces.length} (${(parseRate * 100).toFixed(1)}%)`);

  if (errors.length > 0) {
    console.log(`  First ${errors.length} parse errors:`);
    for (const e of errors) {
      console.log(`    [${e.index}] ${e.output}...`);
      console.log(`         ${e.error}`);
    }
  }

  return { compiles: true, parseRate, errors };
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def;
  };
  const tracesPath = getArg('--traces',
    resolve(__dirname, '../../../exp-slm/phase-2-dsl/corpus/monitor-v2/train.jsonl'));
  const n = parseInt(getArg('--n', '20'));
  const ollamaUrl = getArg('--ollama', 'http://chobits:11434');
  const model = getArg('--model', 'qwen3-coder:30b');
  const dryRun = args.includes('--dry-run');
  const outputPath = getArg('--output',
    resolve(__dirname, '../induced-grammar.peggy'));

  // Load and sample traces
  console.log(`Loading traces from ${tracesPath}...`);
  const allTraces = readFileSync(tracesPath, 'utf-8').trim().split('\n')
    .map(l => JSON.parse(l));

  // Sample N diverse traces (try to get variety)
  const sampled = shuffle(allTraces).slice(0, n);
  console.log(`Sampled ${sampled.length} traces from ${allTraces.length} total`);

  // Build prompt
  const prompt = buildPrompt(sampled);
  console.log(`Prompt size: ${prompt.length} chars`);

  if (dryRun) {
    console.log('\n=== DRY RUN — Prompt: ===\n');
    console.log(prompt.slice(0, 2000) + '\n...[truncated]');
    return;
  }

  // Call frontier LLM with iterative refinement
  let grammar;
  const MAX_REFINEMENTS = 3;

  for (let attempt = 0; attempt <= MAX_REFINEMENTS; attempt++) {
    let currentPrompt;

    if (attempt === 0) {
      currentPrompt = prompt;
    } else {
      // Refinement: feed the compile error back
      currentPrompt = `Your previous PEG grammar had a compilation error. Fix it.

ERROR: ${lastError}

YOUR PREVIOUS GRAMMAR:
${grammar}

Fix the grammar so it compiles with Peggy. Output ONLY the corrected PEG grammar, nothing else.`;
    }

    const response = await callOllama(ollamaUrl, model, currentPrompt);
    grammar = extractGrammar(response);

    console.log(`\n=== Attempt ${attempt + 1} — Grammar (${grammar.length} chars) ===`);
    console.log(grammar.slice(0, 300) + (grammar.length > 300 ? '\n...' : ''));

    // Try to compile
    try {
      peggy.generate(grammar);
      console.log('✓ Grammar compiles!');
      break;
    } catch (e) {
      var lastError = e.message?.slice(0, 300);
      console.log(`✗ Compile error: ${lastError}`);
      if (attempt === MAX_REFINEMENTS) {
        console.log('Max refinements reached. Using last grammar.');
      }
    }
  }

  // Auto-refine
  console.log('\n=== Auto-Refine ===');
  const refined = refineGrammar(grammar, { verbose: true, traces: sampled });
  if (refined.ok && refined.fixesApplied.length > 0) {
    console.log(`Applied fixes: ${refined.fixesApplied.join(', ')}`);
    grammar = refined.grammar;
  }

  // Validate on sample
  console.log('\n=== Validation (sample) ===');
  validateGrammar(grammar, sampled);

  // Validate on held-out
  const heldOut = allTraces.filter(t => !sampled.includes(t)).slice(0, 100);
  if (heldOut.length > 0) {
    console.log(`\n=== Held-Out Validation (${heldOut.length} unseen traces) ===`);
    validateGrammar(grammar, heldOut);
  }

  // Save grammar
  writeFileSync(outputPath, grammar);
  console.log(`\nGrammar saved to ${outputPath}`);

  // Compare to hand-crafted
  const handCraftedPath = resolve(__dirname, '../../../exp-slm/phase-2-dsl/grammars/monitor-v2.peggy');
  try {
    const handCrafted = readFileSync(handCraftedPath, 'utf-8');
    const handParser = peggy.generate(handCrafted);
    let handPass = 0;
    for (const t of sampled) {
      try { handParser.parse(t.output); handPass++; } catch {}
    }
    console.log(`\nHand-crafted grammar: ${handPass}/${sampled.length} parse rate on same traces`);
  } catch (e) {
    console.log(`Could not load hand-crafted grammar: ${e.message}`);
  }
}

main().catch(console.error);
