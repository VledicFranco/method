/**
 * Validate seed type→grammar pairs by compiling each grammar with Peggy
 * and testing that it can parse a generated example.
 *
 * Usage: node experiments/exp-slm-composition/phase-1-schema-grammar/scripts/validate-seeds.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname_local, '../seed-pairs.jsonl');

const testExamples = {
  'monitor-report': `ANOMALIES:\n@reasoner low-confidence "Confidence below threshold"\n@actor unexpected-result "Action failed"\nESCALATE: "Critical anomaly detected"\nRESTRICT: Read, Edit\nREPLAN: yes`,
  'observer-report': `PRIORITY: high\nFOCUS: reasoner, planner\nNOVELTY: 0.85\nNOTE: "New pattern detected"`,
  'evaluator-report': `PROGRESS: on-track\nCONFIDENCE: 0.72\nACTION: continue\nNOTE: none`,
  'token-bucket': `TOKENS: 150.5\nLAST_REFILL: 1711900000.0\nCAPACITY: 200.0\nREFILL_RATE: 10.0`,
  'run-metrics': `CYCLES: 15\nTOTAL_TOKENS: 45000\nINTERVENTIONS: 3\nEVICTIONS: 12\nCOST: 1.50\nVERDICT: "pass"`,
  'reasoner-output': `TRACE: "Analyzing test failure in auth module"\nCONFIDENCE: 0.85\nCONFLICT: no\nACTION: Edit {file: "auth.ts", line: "42"}`,
  'eviction-info': `REASON: capacity\nSALIENCE: 0.32\nSALIENCE_DELTA: -0.15\nTIMESTAMP: 1711900000.5`,
  'goal-representation': `OBJECTIVE: "Extract event bus into separate module"\nCONSTRAINTS:\n- "Preserve all 8 public methods"\n- "Do not modify test expectations"\nSUBGOALS:\n[s1] done "Create event-bus.ts"\n[s2] active "Update import sites"\n[s3] pending "Add barrel export"\nASPIRATION: 0.90`,
  'timeline-options': `TWIN_ID: "franco-main"\nSINCE: "2026-04-01"\nTYPES: decision, observation\nLIMIT: 50`,
  'cluster-config': `ENABLED: yes\nNODE_ID: "node-alpha"\nSEEDS: "localhost:3456,localhost:3457"\nHEARTBEAT_MS: 5000\nSUSPECT_TIMEOUT_MS: 15000\nFEDERATION_ENABLED: no\nINSTANCE_NAME: "dev"\nPORT: 3456`,
  'workspace-entry': `SOURCE: observer\nCONTENT: "Test file created at src/__tests__/auth.test.ts"\nSALIENCE: 0.75\nTIMESTAMP: 1711900000.0\nTTL: 30\nPINNED: yes\nCONTENT_TYPE: observation`,
  'cognitive-module-step': `MODULE_ID: observer\nPHASE: observe\nDURATION_MS: 45.2\nHAS_ERROR: no\nTIMESTAMP: 1711900000.0`,
};

function main() {
  const lines = readFileSync(seedPath, 'utf-8').trim().split('\n');
  const pairs = lines.map(l => JSON.parse(l));

  console.log(`Validating ${pairs.length} seed pairs...\n`);

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const pair of pairs) {
    const example = testExamples[pair.id];
    if (!example) {
      console.log(`  SKIP: ${pair.id} — no test example`);
      continue;
    }

    // Step 1: Compile grammar
    let parser;
    try {
      parser = peggy.generate(pair.grammar);
    } catch (e) {
      console.log(`  FAIL: ${pair.id} — grammar compilation error: ${e.message}`);
      failures.push({ id: pair.id, stage: 'compile', error: e.message });
      fail++;
      continue;
    }

    // Step 2: Parse example
    try {
      const result = parser.parse(example);
      console.log(`  PASS: ${pair.id}`);
      console.log(`        → ${JSON.stringify(result).slice(0, 120)}`);
      pass++;
    } catch (e) {
      console.log(`  FAIL: ${pair.id} — parse error: ${e.message?.slice(0, 300)}`);
      failures.push({ id: pair.id, stage: 'parse', error: e.message?.slice(0, 500) });
      fail++;
    }
  }

  console.log(`\nResults: ${pass} pass, ${fail} fail out of ${pairs.length} pairs`);

  if (failures.length > 0) {
    console.log('\nFailure details:');
    for (const f of failures) {
      console.log(`\n  ${f.id} (${f.stage}):`);
      console.log(`    ${f.error}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main();
