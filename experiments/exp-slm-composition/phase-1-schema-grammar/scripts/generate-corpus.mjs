/**
 * Corpus Generator for B-1 Schema→Grammar SLM
 *
 * Takes 12 seed type→grammar pairs and produces augmented training pairs
 * via systematic transformations:
 *   1. Field subset selection (drop optional fields)
 *   2. Field reordering
 *   3. Type substitution (swap field types)
 *   4. Field count variation (add/remove fields)
 *   5. Enum/union value variation
 *   6. Novel interface synthesis from composable parts
 *
 * Each generated pair is validated: the grammar must compile with Peggy
 * and parse a generated example.
 *
 * Usage: node experiments/exp-slm-composition/phase-1-schema-grammar/scripts/generate-corpus.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, '../seed-pairs.jsonl');
const outDir = resolve(__dirname, '../corpus');

// ── Primitive building blocks ─────────────────────────────────

const FIELD_NAMES = [
  'id', 'name', 'label', 'title', 'description', 'summary', 'message',
  'status', 'state', 'phase', 'mode', 'kind', 'category', 'level', 'severity',
  'value', 'score', 'weight', 'count', 'total', 'limit', 'threshold', 'ratio',
  'duration', 'timeout', 'interval', 'delay', 'retries', 'attempts',
  'enabled', 'active', 'visible', 'required', 'optional', 'locked', 'valid',
  'source', 'target', 'origin', 'destination', 'path', 'url', 'key',
  'timestamp', 'createdAt', 'updatedAt', 'expiresAt', 'startTime', 'endTime',
  'priority', 'confidence', 'progress', 'accuracy', 'coverage',
  'input', 'output', 'result', 'response', 'payload', 'data',
  'width', 'height', 'size', 'capacity', 'length', 'depth',
  'color', 'format', 'encoding', 'version', 'revision',
  'author', 'owner', 'assignee', 'reviewer', 'creator',
  'tags', 'labels', 'items', 'entries', 'records', 'elements',
  'note', 'comment', 'reason', 'cause', 'error',
];

const ENUM_SETS = [
  ['low', 'medium', 'high'],
  ['pending', 'active', 'done'],
  ['open', 'closed', 'archived'],
  ['debug', 'info', 'warn', 'error'],
  ['draft', 'review', 'approved', 'published'],
  ['read', 'write', 'admin'],
  ['success', 'failure', 'timeout', 'cancelled'],
  ['none', 'partial', 'full'],
  ['ascending', 'descending'],
  ['on-track', 'stagnant', 'diverging'],
  ['continue', 'replan', 'escalate'],
  ['capacity', 'ttl', 'manual'],
  ['text', 'code', 'error', 'tool-output'],
  ['observation', 'action', 'result', 'goal', 'constraint'],
  ['stable', 'degraded', 'critical'],
  ['queued', 'running', 'completed', 'failed'],
  ['allow', 'deny', 'prompt'],
  ['input', 'output', 'bidirectional'],
];

// ── Type definitions for generation ───────────────────────────

// A field has a name, type, and whether it's optional
// Types: string, number, boolean, float, integer, enum, string-array, enum-array
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

function pickN(arr, n) {
  return shuffle(arr).slice(0, n);
}

// ── Interface generation ──────────────────────────────────────

function generateField() {
  const name = randomChoice(FIELD_NAMES);
  const optional = Math.random() < 0.3;
  const typeRoll = Math.random();

  let type, enumValues;
  if (typeRoll < 0.25) {
    type = 'string';
  } else if (typeRoll < 0.40) {
    type = 'number';
  } else if (typeRoll < 0.50) {
    type = 'integer';
  } else if (typeRoll < 0.60) {
    type = 'boolean';
  } else if (typeRoll < 0.75) {
    type = 'enum';
    enumValues = randomChoice(ENUM_SETS);
  } else if (typeRoll < 0.85) {
    type = 'string-array';
  } else if (typeRoll < 0.92) {
    type = 'enum-array';
    enumValues = randomChoice(ENUM_SETS);
  } else {
    type = 'nullable-string';
  }

  return { name, type, optional, enumValues };
}

function generateInterface(fieldCount) {
  const usedNames = new Set();
  const fields = [];
  let attempts = 0;

  while (fields.length < fieldCount && attempts < 100) {
    const field = generateField();
    if (!usedNames.has(field.name)) {
      usedNames.add(field.name);
      fields.push(field);
    }
    attempts++;
  }

  // Generate interface name
  const prefixes = ['', 'Base', 'Core', 'Raw', 'Parsed', 'Validated'];
  const nouns = [
    'Config', 'Report', 'Event', 'Entry', 'Record', 'Status', 'Info',
    'Result', 'Options', 'Params', 'State', 'Context', 'Metrics',
    'Signal', 'Output', 'Input', 'Request', 'Response', 'Snapshot',
    'Summary', 'Details', 'Spec', 'Definition', 'Descriptor',
    'Profile', 'Settings', 'Manifest', 'Schema', 'Model',
  ];
  const interfaceName = randomChoice(prefixes) + randomChoice(nouns);

  return { name: interfaceName, fields };
}

// ── TypeScript rendering ──────────────────────────────────────

function fieldToTypeScript(field) {
  const opt = field.optional ? '?' : '';
  let tsType;
  switch (field.type) {
    case 'string': tsType = 'string'; break;
    case 'number':
    case 'integer':
    case 'float': tsType = 'number'; break;
    case 'boolean': tsType = 'boolean'; break;
    case 'enum': tsType = field.enumValues.map(v => `'${v}'`).join(' | '); break;
    case 'string-array': tsType = 'string[]'; break;
    case 'enum-array': tsType = `Array<${field.enumValues.map(v => `'${v}'`).join(' | ')}>`;  break;
    case 'nullable-string': tsType = 'string | null'; break;
    default: tsType = 'string';
  }
  return `  ${field.name}${opt}: ${tsType};`;
}

function interfaceToTypeScript(iface) {
  const lines = [`interface ${iface.name} {`];
  for (const f of iface.fields) {
    lines.push(fieldToTypeScript(f));
  }
  lines.push('}');
  return lines.join('\n');
}

// ── PEG Grammar rendering ────────────────────────────────────

function fieldToSectionName(fieldName) {
  // camelCase → PascalCase + "Section" or "Opt"
  const pascal = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  return pascal;
}

function fieldToGrammarRule(field) {
  const sectionName = fieldToSectionName(field.name);
  const label = field.name.toUpperCase().replace(/([A-Z])/g, (m, c, i) =>
    i > 0 && field.name[i-1] !== field.name[i-1].toUpperCase() ? '_' + c : c
  );
  // Convert camelCase to UPPER_SNAKE for DSL keys
  const dslKey = field.name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toUpperCase();

  const lines = [];

  if (field.optional) {
    // Optional field: match or return undefined
    switch (field.type) {
      case 'string':
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ v:QuotedString { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      case 'number':
      case 'float':
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ v:Float { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      case 'integer':
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ v:Integer { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      case 'boolean':
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ v:Bool { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      case 'enum':
        lines.push(`${sectionName}Opt`);
        const eAlts = field.enumValues.map(v => `"${v}"`).join(' / ');
        lines.push(`  = EOL "${dslKey}:" _ v:(${eAlts}) { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      case 'nullable-string':
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ "none" { return null; }`);
        lines.push(`  / EOL "${dslKey}:" _ v:QuotedString { return v; }`);
        lines.push(`  / "" { return undefined; }`);
        break;
      default:
        lines.push(`${sectionName}Opt`);
        lines.push(`  = EOL "${dslKey}:" _ v:QuotedString { return v; }`);
        lines.push(`  / "" { return undefined; }`);
    }
  } else {
    // Required field
    switch (field.type) {
      case 'string':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:QuotedString { return v; }`);
        break;
      case 'number':
      case 'float':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:Float { return v; }`);
        break;
      case 'integer':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:Integer { return v; }`);
        break;
      case 'boolean':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:Bool { return v; }`);
        break;
      case 'enum':
        const alts = field.enumValues.map(v => `"${v}"`).join(' / ');
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:(${alts}) { return v; }`);
        break;
      case 'string-array':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ "none" { return []; }`);
        lines.push(`  / "${dslKey}:" _ first:Identifier rest:("," _ id:Identifier { return id; })* { return [first, ...rest]; }`);
        break;
      case 'enum-array':
        const eaAlts = field.enumValues.map(v => `"${v}"`).join(' / ');
        const eaName = sectionName + 'Value';
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ "none" { return []; }`);
        lines.push(`  / "${dslKey}:" _ first:${eaName} rest:("," _ v:${eaName} { return v; })* { return [first, ...rest]; }`);
        lines.push('');
        lines.push(`${eaName}`);
        lines.push(`  = ${eaAlts}`);
        break;
      case 'nullable-string':
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ "none" { return null; }`);
        lines.push(`  / "${dslKey}:" _ v:QuotedString { return v; }`);
        break;
      default:
        lines.push(`${sectionName}Section`);
        lines.push(`  = "${dslKey}:" _ v:QuotedString { return v; }`);
    }
  }

  return lines.join('\n');
}

function interfaceToGrammar(iface) {
  const required = iface.fields.filter(f => !f.optional);
  const optional = iface.fields.filter(f => f.optional);

  // Build top-level rule
  const topLabels = [];
  const topRefs = [];
  const returnFields = [];

  for (const f of required) {
    const sn = fieldToSectionName(f.name);
    const label = f.name.charAt(0);
    // Use unique short labels
    const uniqueLabel = f.name;
    topLabels.push(`${uniqueLabel}:${sn}Section`);
    returnFields.push(`${f.name}: ${uniqueLabel}`);
  }
  for (const f of optional) {
    const sn = fieldToSectionName(f.name);
    const uniqueLabel = f.name;
    topLabels.push(`${uniqueLabel}:${sn}Opt`);
    returnFields.push(`${f.name}: ${uniqueLabel}`);
  }

  // Join required with EOL, optional just concatenated (they handle their own EOL)
  const reqParts = [];
  for (let i = 0; i < required.length; i++) {
    const sn = fieldToSectionName(required[i].name);
    if (i === 0) {
      reqParts.push(`${required[i].name}:${sn}Section`);
    } else {
      reqParts.push(`EOL ${required[i].name}:${sn}Section`);
    }
  }

  const optParts = optional.map(f => {
    const sn = fieldToSectionName(f.name);
    return `${f.name}:${sn}Opt`;
  });

  const allParts = [...reqParts, ...optParts].join(' ');
  const returnObj = returnFields.join(', ');

  const lines = [];
  lines.push(iface.name);
  lines.push(`  = ${allParts} EOLopt`);
  lines.push(`    { return { ${returnObj} }; }`);
  lines.push('');

  // Field rules
  for (const f of [...required, ...optional]) {
    lines.push(fieldToGrammarRule(f));
    lines.push('');
  }

  // Primitives — use known-working patterns
  const needsBool = iface.fields.some(f => f.type === 'boolean');
  const needsInt = iface.fields.some(f => f.type === 'integer');
  const needsFloat = iface.fields.some(f => ['number', 'float'].includes(f.type));
  const needsId = iface.fields.some(f => ['string-array', 'enum-array'].includes(f.type));

  if (needsBool) lines.push('Bool = "yes" { return true; } / "no" { return false; }');
  if (needsId) lines.push('Identifier = chars:$[a-zA-Z0-9_-]+ { return chars; }');
  lines.push('QuotedString = \'"\' chars:$[^"]* \'"\' { return chars; }');
  if (needsFloat) lines.push('Float = chars:$([0-9]+ ("." [0-9]+)?) { return parseFloat(chars); }');
  if (needsInt) lines.push('Integer = chars:$[0-9]+ { return parseInt(chars, 10); }');

  // EOL rules — use the exact byte sequence that works
  lines.push('_ = [ \\t]*');
  lines.push('EOL = _ "\\n"');
  lines.push('EOLopt = (_ "\\n")?');

  return lines.join('\n');
}

// ── Example generation (for validation) ───────────────────────

function generateExample(iface) {
  const lines = [];
  for (const f of iface.fields) {
    if (f.optional && Math.random() < 0.4) continue; // skip some optionals

    const dslKey = f.name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

    switch (f.type) {
      case 'string':
        lines.push(`${dslKey}: "example-${f.name}"`);
        break;
      case 'number':
      case 'float':
        lines.push(`${dslKey}: ${(Math.random() * 100).toFixed(2)}`);
        break;
      case 'integer':
        lines.push(`${dslKey}: ${randomInt(0, 1000)}`);
        break;
      case 'boolean':
        lines.push(`${dslKey}: ${Math.random() < 0.5 ? 'yes' : 'no'}`);
        break;
      case 'enum':
        lines.push(`${dslKey}: ${randomChoice(f.enumValues)}`);
        break;
      case 'string-array':
        const items = pickN(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], randomInt(1, 3));
        lines.push(`${dslKey}: ${items.join(', ')}`);
        break;
      case 'enum-array':
        const eItems = pickN(f.enumValues, randomInt(1, Math.min(3, f.enumValues.length)));
        lines.push(`${dslKey}: ${eItems.join(', ')}`);
        break;
      case 'nullable-string':
        if (Math.random() < 0.3) {
          lines.push(`${dslKey}: none`);
        } else {
          lines.push(`${dslKey}: "example-${f.name}-value"`);
        }
        break;
    }
  }
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  // Load seed pairs
  const seedLines = readFileSync(seedPath, 'utf-8').trim().split('\n');
  const seeds = seedLines.map(l => JSON.parse(l));
  console.log(`Loaded ${seeds.length} seed pairs`);

  const corpus = [];
  let validated = 0;
  let failed = 0;

  // 1. Include all seed pairs as-is
  for (const seed of seeds) {
    corpus.push({ input: seed.interface, output: seed.grammar });
  }
  console.log(`Added ${seeds.length} seed pairs directly`);

  // 2. Generate synthetic interfaces
  const TARGET = 2000;
  const ATTEMPTS = TARGET * 3; // generate more, filter by validation

  console.log(`Generating synthetic pairs (target: ${TARGET})...`);

  for (let i = 0; i < ATTEMPTS && corpus.length < TARGET; i++) {
    const fieldCount = randomInt(3, 8);
    const iface = generateInterface(fieldCount);
    const tsCode = interfaceToTypeScript(iface);
    const grammar = interfaceToGrammar(iface);

    // Validate: compile grammar
    let parser;
    try {
      parser = peggy.generate(grammar);
    } catch (e) {
      failed++;
      continue;
    }

    // Validate: parse example
    const example = generateExample(iface);
    try {
      parser.parse(example);
    } catch (e) {
      failed++;
      continue;
    }

    corpus.push({ input: tsCode, output: grammar });
    validated++;

    if (validated % 200 === 0) {
      console.log(`  Generated ${validated} valid pairs (${failed} failed)...`);
    }
  }

  console.log(`\nGeneration complete: ${validated} synthetic + ${seeds.length} seeds = ${corpus.length} total`);
  console.log(`Failed attempts: ${failed}`);

  // Shuffle
  const shuffled = shuffle(corpus);

  // Split 80/20
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, splitIdx);
  const holdout = shuffled.slice(splitIdx);

  // Write corpus
  try { mkdirSync(outDir, { recursive: true }); } catch {}

  writeFileSync(
    resolve(outDir, 'train.jsonl'),
    train.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
  writeFileSync(
    resolve(outDir, 'holdout.jsonl'),
    holdout.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  console.log(`\nWrote ${train.length} train + ${holdout.length} holdout to ${outDir}/`);
}

main();
