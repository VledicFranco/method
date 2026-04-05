/**
 * KPI Checker Corpus Generator
 *
 * Generates (KPI description + context → Check DSL expression) training pairs.
 * Uses seed pairs from the task suite (T01-T06) and expands synthetically.
 *
 * Every generated pair is validated: the DSL output must parse through
 * the Check DSL Peggy grammar.
 *
 * Usage: node experiments/exp-slm-composition/phase-2-bootstrap/kpi-checker/scripts/generate-corpus.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(__dirname, '../check-dsl.peggy');
const outDir = resolve(__dirname, '../corpus');

// ── Helpers ──────────────────────────────────────────────────

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Seed pairs from task suite ───────────────────────────────

const SEED_PAIRS = [
  // T01: Circular dependency fix
  { kpi: "No circular dependency in import graph", context: { objective: "Fix circular dependency between modules", knownPaths: ["src/module-a.ts", "src/module-b.ts"], knownIdentifiers: [], difficulty: "medium" }, dsl: "file_contains('src/module-a.ts', 'import')" },

  // T02: Formula fix
  { kpi: "applyDiscount formula fixed", context: { objective: "Fix the discount calculation bug", knownPaths: ["src/pricing.ts"], knownIdentifiers: ["applyDiscount"], difficulty: "low" }, dsl: "file_contains('src/pricing.ts', 'price - (price * percent / 100)')" },

  // T04: v2 handler
  { kpi: "v2 handler file created", context: { objective: "Create v2 order handler", knownPaths: ["src/handlers/"], knownIdentifiers: ["handleOrderV2"], difficulty: "medium" }, dsl: "file_exists('src/handlers/v2.ts')" },
  { kpi: "v2 handler exports handleOrderV2", context: { objective: "Create v2 order handler", knownPaths: ["src/handlers/v2.ts"], knownIdentifiers: ["handleOrderV2"], difficulty: "medium" }, dsl: "file_exports('src/handlers/v2.ts', 'handleOrderV2')" },
  { kpi: "Router handles v2 requests", context: { objective: "Create v2 order handler", knownPaths: ["src/router.ts", "src/handlers/v2.ts"], knownIdentifiers: ["handleOrderV2"], difficulty: "medium" }, dsl: "file_contains('src/router.ts', 'v2')" },
  { kpi: "v2 handler file exists and exports handler", context: { objective: "Create v2 order handler", knownPaths: ["src/handlers/v2.ts"], knownIdentifiers: ["handleOrderV2"], difficulty: "medium" }, dsl: "file_exists('src/handlers/v2.ts') && file_exports('src/handlers/v2.ts', 'handleOrderV2')" },

  // T05: Trap task (don't delete files)
  { kpi: "No files were removed", context: { objective: "Refactor without removing files", knownPaths: ["src/"], knownIdentifiers: [], difficulty: "low" }, dsl: "file_count_changed(0)" },

  // Generic coding tasks
  { kpi: "config file exists", context: { objective: "Set up configuration", knownPaths: ["src/"], knownIdentifiers: [], difficulty: "low" }, dsl: "file_exists('src/config.ts')" },
  { kpi: "handler contains function", context: { objective: "Implement order handler", knownPaths: ["src/handler.ts"], knownIdentifiers: ["handleOrder"], difficulty: "low" }, dsl: "file_contains('src/handler.ts', 'handleOrder')" },
  { kpi: "handler exports symbol", context: { objective: "Implement order handler", knownPaths: ["src/handler.ts"], knownIdentifiers: ["handleOrder"], difficulty: "low" }, dsl: "file_exports('src/handler.ts', 'handleOrder')" },
  { kpi: "test file created", context: { objective: "Add unit tests", knownPaths: ["src/handler.ts"], knownIdentifiers: ["handleOrder"], difficulty: "low" }, dsl: "file_exists('src/handler.test.ts')" },
  { kpi: "test file contains test cases", context: { objective: "Add unit tests", knownPaths: ["src/handler.test.ts"], knownIdentifiers: [], difficulty: "low" }, dsl: "file_contains('src/handler.test.ts', 'test')" },
];

// ── Vocabulary for synthetic expansion ───────────────────────

const ACTIONS = [
  'created', 'exists', 'was written', 'has been added', 'is present',
  'was generated', 'is available', 'was set up', 'was initialized',
];

const FILE_TYPES = [
  { ext: '.ts', dir: 'src/', names: ['handler', 'service', 'controller', 'middleware', 'router', 'config', 'utils', 'types', 'index', 'factory', 'adapter', 'validator', 'parser', 'logger'] },
  { ext: '.test.ts', dir: 'src/', names: ['handler', 'service', 'controller', 'middleware', 'router', 'utils', 'validator', 'parser'] },
  { ext: '.ts', dir: 'src/components/', names: ['Button', 'Modal', 'Form', 'Table', 'Header', 'Footer', 'Sidebar', 'Card'] },
  { ext: '.ts', dir: 'lib/', names: ['database', 'cache', 'queue', 'email', 'auth', 'storage', 'metrics'] },
  { ext: '.ts', dir: 'api/', names: ['routes', 'endpoints', 'middleware', 'auth', 'validation'] },
];

const EXPORTS = [
  'createHandler', 'processRequest', 'handleEvent', 'initService',
  'validateInput', 'parseConfig', 'buildQuery', 'formatOutput',
  'authenticateUser', 'authorizeRequest', 'sendNotification',
  'connectDatabase', 'createRouter', 'registerRoutes', 'startServer',
  'applyMiddleware', 'configureApp', 'setupLogger', 'initCache',
  'handleOrderV2', 'processPayment', 'createUser', 'deleteRecord',
  'updateProfile', 'fetchData', 'transformResponse', 'serializeOutput',
];

const PATTERNS = [
  'import', 'export', 'function', 'class', 'interface', 'const',
  'async', 'await', 'return', 'throw', 'try', 'catch',
  'describe', 'it', 'expect', 'test', 'beforeEach', 'afterEach',
  'DATABASE_URL', 'API_KEY', 'PORT', 'HOST', 'SECRET',
  'handleOrder', 'processRequest', 'validateInput', 'createUser',
];

const OBJECTIVES = [
  'Implement the order processing handler',
  'Fix the authentication bug',
  'Add unit tests for the service',
  'Refactor the database module',
  'Create the API endpoint',
  'Set up the configuration file',
  'Implement the middleware',
  'Add error handling',
  'Create the data model',
  'Implement the validation logic',
  'Set up the routing',
  'Add logging to the service',
  'Create the export utilities',
  'Implement the cache layer',
  'Add the notification service',
];

// ── KPI templates ────────────────────────────────────────────

function generateFileExistsPair() {
  const ft = randomChoice(FILE_TYPES);
  const name = randomChoice(ft.names);
  const path = `${ft.dir}${name}${ft.ext}`;
  const action = randomChoice(ACTIONS);
  const kpi = `${name} file ${action}`;
  return {
    kpi,
    context: {
      objective: randomChoice(OBJECTIVES),
      knownPaths: [ft.dir, path],
      knownIdentifiers: [],
      difficulty: randomChoice(['low', 'medium']),
    },
    dsl: `file_exists('${path}')`,
  };
}

function generateFileContainsPair() {
  const ft = randomChoice(FILE_TYPES);
  const name = randomChoice(ft.names);
  const path = `${ft.dir}${name}${ft.ext}`;
  const pattern = randomChoice(PATTERNS);
  const templates = [
    `${name} file contains ${pattern}`,
    `${path} includes ${pattern}`,
    `${pattern} is present in ${name}`,
    `${name} has ${pattern} defined`,
    `${name} uses ${pattern}`,
  ];
  return {
    kpi: randomChoice(templates),
    context: {
      objective: randomChoice(OBJECTIVES),
      knownPaths: [path],
      knownIdentifiers: [pattern],
      difficulty: randomChoice(['low', 'medium', 'high']),
    },
    dsl: `file_contains('${path}', '${pattern}')`,
  };
}

function generateFileExportsPair() {
  const ft = randomChoice(FILE_TYPES.filter(f => !f.ext.includes('test')));
  const name = randomChoice(ft.names);
  const path = `${ft.dir}${name}${ft.ext}`;
  const exportName = randomChoice(EXPORTS);
  const templates = [
    `${name} exports ${exportName}`,
    `${exportName} is exported from ${name}`,
    `${path} exports ${exportName}`,
    `${exportName} is available as an export`,
    `${name} module exports ${exportName} function`,
  ];
  return {
    kpi: randomChoice(templates),
    context: {
      objective: randomChoice(OBJECTIVES),
      knownPaths: [path],
      knownIdentifiers: [exportName],
      difficulty: randomChoice(['low', 'medium']),
    },
    dsl: `file_exports('${path}', '${exportName}')`,
  };
}

function generateFileCountPair() {
  const n = randomInt(0, 3);
  const templates = n === 0
    ? ['No files were removed', 'File count unchanged', 'No new files created or removed']
    : [`${n} new file${n > 1 ? 's' : ''} created`, `At least ${n} file${n > 1 ? 's' : ''} added`];
  return {
    kpi: randomChoice(templates),
    context: {
      objective: randomChoice(OBJECTIVES),
      knownPaths: ['src/'],
      knownIdentifiers: [],
      difficulty: randomChoice(['low', 'medium']),
    },
    dsl: `file_count_changed(${n})`,
  };
}

function generateCompositePair() {
  const ft = randomChoice(FILE_TYPES.filter(f => !f.ext.includes('test')));
  const name = randomChoice(ft.names);
  const path = `${ft.dir}${name}${ft.ext}`;
  const exportName = randomChoice(EXPORTS);

  const composites = [
    {
      kpi: `${name} file created and exports ${exportName}`,
      dsl: `file_exists('${path}') && file_exports('${path}', '${exportName}')`,
    },
    {
      kpi: `${name} exists and contains ${exportName}`,
      dsl: `file_exists('${path}') && file_contains('${path}', '${exportName}')`,
    },
    {
      kpi: `${name} file has ${exportName} exported and contains import`,
      dsl: `file_exports('${path}', '${exportName}') && file_contains('${path}', 'import')`,
    },
  ];

  const c = randomChoice(composites);
  return {
    kpi: c.kpi,
    context: {
      objective: randomChoice(OBJECTIVES),
      knownPaths: [path],
      knownIdentifiers: [exportName],
      difficulty: randomChoice(['medium', 'high']),
    },
    dsl: c.dsl,
  };
}

// ── Format for SLM training ──────────────────────────────────

function formatInput(pair) {
  const ctx = pair.context;
  const lines = [
    `<kpi>${pair.kpi}</kpi>`,
    `<context>`,
    `  objective: ${ctx.objective}`,
    `  paths: ${ctx.knownPaths.join(', ')}`,
  ];
  if (ctx.knownIdentifiers.length > 0) {
    lines.push(`  identifiers: ${ctx.knownIdentifiers.join(', ')}`);
  }
  lines.push(`  difficulty: ${ctx.difficulty}`);
  lines.push(`</context>`);
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  // Load and compile grammar
  const grammar = readFileSync(grammarPath, 'utf-8');
  const parser = peggy.generate(grammar);

  console.log('Check DSL grammar compiled OK\n');

  const corpus = [];
  let validated = 0;
  let failed = 0;

  // Add seed pairs
  for (const seed of SEED_PAIRS) {
    try {
      parser.parse(seed.dsl);
      corpus.push({ input: formatInput(seed), output: seed.dsl });
      validated++;
    } catch (e) {
      console.log(`Seed FAIL: ${seed.kpi} → ${e.message?.slice(0, 80)}`);
      failed++;
    }
  }
  console.log(`Seeds: ${validated} valid, ${failed} failed`);

  // Generate synthetic pairs
  const TARGET = 3000;
  const generators = [
    { fn: generateFileExistsPair, weight: 25 },
    { fn: generateFileContainsPair, weight: 25 },
    { fn: generateFileExportsPair, weight: 20 },
    { fn: generateFileCountPair, weight: 10 },
    { fn: generateCompositePair, weight: 20 },
  ];

  console.log(`\nGenerating synthetic pairs (target: ${TARGET})...`);

  for (let i = 0; corpus.length < TARGET; i++) {
    // Weighted random selection
    const roll = randomInt(1, 100);
    let cumulative = 0;
    let pair;
    for (const g of generators) {
      cumulative += g.weight;
      if (roll <= cumulative) {
        pair = g.fn();
        break;
      }
    }
    if (!pair) pair = generators[0].fn();

    // Validate: does the DSL parse?
    try {
      parser.parse(pair.dsl);
      corpus.push({ input: formatInput(pair), output: pair.dsl });
      validated++;
    } catch {
      failed++;
    }

    if (validated % 500 === 0 && validated > SEED_PAIRS.length) {
      console.log(`  ${validated} valid (${failed} failed)...`);
    }
  }

  console.log(`\nTotal: ${corpus.length} valid, ${failed} failed`);

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

  // Stats
  const typeCount = { file_exists: 0, file_contains: 0, file_exports: 0, file_count_changed: 0, composite: 0 };
  for (const e of corpus) {
    if (e.output.includes('&&')) typeCount.composite++;
    else if (e.output.startsWith('file_exists')) typeCount.file_exists++;
    else if (e.output.startsWith('file_contains')) typeCount.file_contains++;
    else if (e.output.startsWith('file_exports')) typeCount.file_exports++;
    else if (e.output.startsWith('file_count_changed')) typeCount.file_count_changed++;
  }
  console.log('\nDistribution:', typeCount);
}

main();
