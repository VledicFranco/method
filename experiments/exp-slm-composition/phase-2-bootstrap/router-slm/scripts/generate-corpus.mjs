/**
 * Router SLM Corpus Generator
 *
 * Binary classifier: task description → "flat" or "unified-memory"
 *
 * Ground truth from R-28/R-29/R-30b experiments:
 *   flat:           single-file fixes, clear multi-file tasks, trap detection
 *   unified-memory: structural refactoring, config migration, complex extraction
 *
 * Usage: node experiments/exp-slm-composition/phase-2-bootstrap/router-slm/scripts/generate-corpus.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// ── Task pattern templates ───────────────────────────────────

// FLAT patterns: single-file fixes, clear multi-file with obvious goals, traps
const FLAT_PATTERNS = [
  // T02-like: single-file bug fix
  (v) => `Fix the ${v.bug} bug in ${v.file}. The ${v.func} function has a ${v.issue}.`,
  (v) => `There's a calculation error in ${v.file}. The ${v.func} function returns wrong results for ${v.case}.`,
  (v) => `Debug and fix ${v.func} in ${v.file}. Expected ${v.expected} but getting ${v.actual}.`,
  (v) => `The ${v.func} function in ${v.file} has an off-by-one error when processing ${v.case}.`,
  (v) => `Fix the ${v.issue} in ${v.func}. It's in ${v.file}, line around ${v.line}.`,

  // T04-like: multi-file but clear goals (KEY PATTERN — often misrouted)
  (v) => `Create ${v.version} ${v.component} handler. Update ${v.router}. Do not include ${v.sideEffect1} or ${v.sideEffect2} side effects.`,
  (v) => `Add a ${v.version} endpoint for ${v.resource}. Wire it into ${v.router}. Keep it simple, no ${v.sideEffect1}.`,
  (v) => `Implement ${v.version} ${v.resource} handler in ${v.newFile}. Register in ${v.router}. No extra features.`,
  (v) => `Create a new ${v.component} at ${v.newFile}. Export ${v.func} and add route in ${v.router}.`,
  (v) => `Add ${v.version} support to ${v.resource} API. New handler file, update router. Pure implementation, no side effects.`,

  // T05-like: trap detection / simple refactoring
  (v) => `Clean up unused imports in ${v.file}. Do NOT remove any functions or exports.`,
  (v) => `Refactor ${v.func} for readability. Same behavior, no functional changes.`,
  (v) => `Remove deprecated ${v.feature} from ${v.file}. Don't touch anything else.`,
  (v) => `Rename ${v.oldName} to ${v.newName} across the project. Pure rename, no logic changes.`,
  (v) => `Update ${v.file} to use ${v.newPattern} instead of ${v.oldPattern}. Behavior must stay identical.`,

  // Simple additions
  (v) => `Add a ${v.func} function to ${v.file}. It should ${v.behavior}.`,
  (v) => `Write a utility function ${v.func} that ${v.behavior}. Put it in ${v.file}.`,
  (v) => `Add input validation to ${v.func} in ${v.file}. Throw on invalid ${v.param}.`,
  (v) => `Add error handling to ${v.func}. Catch ${v.errorType} and return ${v.fallback}.`,
  (v) => `Implement ${v.func} in ${v.file}. Simple ${v.behavior}, no dependencies.`,
];

// UNIFIED-MEMORY patterns: structural refactoring, dependency management, complex extraction
const UNIFIED_MEMORY_PATTERNS = [
  // T01-like: circular dependency / structural refactoring
  (v) => `Fix the circular dependency between ${v.moduleA} and ${v.moduleB}. Extract shared types to ${v.sharedModule}.`,
  (v) => `${v.moduleA} and ${v.moduleB} have circular imports. Break the cycle by ${v.strategy}.`,
  (v) => `Refactor the dependency chain: ${v.moduleA} → ${v.moduleB} → ${v.moduleC}. Eliminate the back-reference from ${v.moduleC} to ${v.moduleA}.`,
  (v) => `Extract the ${v.concept} logic from ${v.moduleA} into a new module ${v.newModule}. Update all import sites.`,
  (v) => `The ${v.concept} is scattered across ${v.count} files. Consolidate into ${v.newModule} with a clean public API.`,

  // T03-like: config migration / multi-file coordination
  (v) => `Migrate ${v.config} from ${v.oldFormat} to ${v.newFormat}. Update all ${v.count} consumers.`,
  (v) => `Replace ${v.oldLib} with ${v.newLib} across the project. Update imports, types, and initialization in ${v.count} files.`,
  (v) => `Add ${v.envVar} environment variable support. Wire it through ${v.configFile}, ${v.serviceFile}, and ${v.handlerFile}.`,
  (v) => `Set up ${v.feature} infrastructure: create ${v.configFile}, update ${v.serviceFile}, add middleware to ${v.serverFile}.`,
  (v) => `Implement ${v.feature} across the stack: database schema, service layer, API route, and frontend component.`,

  // T06-like: complex multi-file extraction
  (v) => `Extract the ${v.domain} domain into its own module. Move types, logic, tests, and routes. Update ${v.count}+ import sites.`,
  (v) => `Split ${v.monolith} into ${v.moduleA} and ${v.moduleB}. Maintain backward compatibility. Update all consumers.`,
  (v) => `Implement ${v.feature} end-to-end: ${v.layer1}, ${v.layer2}, ${v.layer3}, and ${v.layer4}. All layers must coordinate.`,
  (v) => `Redesign the ${v.concept} system. Replace ${v.oldApproach} with ${v.newApproach}. Affects ${v.count} files across ${v.layers} layers.`,
  (v) => `Add ${v.feature} with cross-cutting concerns: ${v.concern1}, ${v.concern2}, and ${v.concern3}. Touches every layer.`,

  // Architecture-level changes
  (v) => `Introduce the ${v.pattern} pattern for ${v.domain}. Create interface, implementation, and wire through DI.`,
  (v) => `Replace direct ${v.resource} access with a ${v.abstraction} layer. All ${v.count} call sites need updating.`,
  (v) => `Add ${v.observability} to the ${v.domain} pipeline: logging, metrics, and error tracking at each stage.`,
  (v) => `Implement event sourcing for ${v.domain}: event store, projection, and ${v.count} event handlers.`,
  (v) => `Create a plugin system for ${v.domain}. Define plugin interface, loader, and lifecycle management.`,
];

// ── Vocabulary for variable substitution ─────────────────────

const VARS = {
  bug: ['discount', 'pricing', 'calculation', 'formatting', 'sorting', 'pagination', 'validation', 'auth', 'parsing', 'encoding'],
  file: ['src/pricing.ts', 'src/utils.ts', 'src/handler.ts', 'src/service.ts', 'lib/math.ts', 'src/formatter.ts', 'src/validator.ts', 'api/routes.ts'],
  func: ['applyDiscount', 'calculateTotal', 'formatCurrency', 'validateInput', 'parseConfig', 'processRequest', 'handleEvent', 'computeHash', 'serializeData', 'buildQuery'],
  issue: ['wrong formula', 'off-by-one error', 'integer overflow', 'null reference', 'type mismatch', 'missing edge case', 'incorrect rounding'],
  case: ['negative numbers', 'empty arrays', 'large inputs', 'unicode strings', 'zero values', 'boundary conditions'],
  expected: ['correct total', 'valid output', 'proper format', 'matching hash'],
  actual: ['NaN', 'undefined', 'wrong value', 'empty string', 'stack overflow'],
  line: ['42', '87', '123', '156', '200', '15', '234'],
  version: ['v2', 'v3', 'beta', 'next'],
  component: ['order', 'payment', 'user', 'product', 'notification', 'report'],
  router: ['src/router.ts', 'src/routes/index.ts', 'api/router.ts', 'src/app.ts'],
  resource: ['orders', 'users', 'products', 'payments', 'invoices', 'reports'],
  sideEffect1: ['notification', 'audit logging', 'analytics', 'caching'],
  sideEffect2: ['email', 'webhook', 'metrics', 'backup'],
  newFile: ['src/handlers/v2.ts', 'api/v2/handler.ts', 'src/routes/v2.ts', 'lib/handlers/next.ts'],
  feature: ['caching', 'rate limiting', 'auth', 'logging', 'metrics', 'webhooks', 'i18n'],
  oldName: ['processOrder', 'handleRequest', 'UserService', 'formatDate', 'APIClient'],
  newName: ['processOrderV2', 'handleHttpRequest', 'UserManager', 'formatDateTime', 'HttpClient'],
  newPattern: ['async/await', 'dependency injection', 'builder pattern', 'factory method'],
  oldPattern: ['callbacks', 'service locator', 'constructor chaining', 'singleton'],
  behavior: ['validate and transform input', 'parse and normalize data', 'compute the result', 'format the output'],
  param: ['input', 'config', 'userId', 'amount', 'path'],
  errorType: ['NetworkError', 'ValidationError', 'TimeoutError', 'ParseError'],
  fallback: ['null', 'default value', 'empty array', 'cached result'],
  moduleA: ['src/auth.ts', 'src/user.ts', 'lib/core.ts', 'src/domain/orders.ts', 'src/services/payment.ts'],
  moduleB: ['src/permissions.ts', 'src/profile.ts', 'lib/utils.ts', 'src/domain/products.ts', 'src/services/notification.ts'],
  moduleC: ['src/session.ts', 'src/api.ts', 'lib/types.ts', 'src/domain/inventory.ts'],
  sharedModule: ['src/shared/types.ts', 'lib/common.ts', 'src/core/interfaces.ts'],
  strategy: ['extracting shared types', 'introducing an interface', 'using dependency injection', 'creating a mediator'],
  concept: ['authentication', 'event handling', 'data validation', 'error handling', 'logging', 'caching', 'serialization'],
  newModule: ['src/core/auth.ts', 'lib/events.ts', 'src/shared/validation.ts', 'src/infra/logging.ts'],
  count: ['3', '4', '5', '6', '8', '10', '12'],
  config: ['database config', 'API keys', 'feature flags', 'service endpoints'],
  oldFormat: ['JSON file', 'hardcoded constants', '.env file', 'YAML config'],
  newFormat: ['environment variables', 'config service', 'Vault secrets', 'typed config module'],
  oldLib: ['moment.js', 'request', 'lodash', 'express-validator'],
  newLib: ['date-fns', 'fetch', 'native methods', 'zod'],
  envVar: ['DATABASE_URL', 'API_KEY', 'REDIS_URL', 'LOG_LEVEL'],
  configFile: ['src/config.ts', 'lib/config.ts', 'src/env.ts'],
  serviceFile: ['src/service.ts', 'src/app.ts', 'lib/server.ts'],
  handlerFile: ['src/handler.ts', 'api/routes.ts', 'src/middleware.ts'],
  serverFile: ['src/server.ts', 'src/app.ts', 'index.ts'],
  domain: ['user management', 'order processing', 'event bus', 'billing', 'notifications', 'analytics'],
  monolith: ['src/app.ts', 'src/service.ts', 'lib/core.ts'],
  layer1: ['database migration', 'data model', 'repository layer'],
  layer2: ['service layer', 'business logic', 'domain rules'],
  layer3: ['API routes', 'controller', 'HTTP handler'],
  layer4: ['tests', 'documentation', 'frontend component'],
  layers: ['2', '3', '4'],
  oldApproach: ['monolithic service', 'global state', 'sync processing'],
  newApproach: ['microservices', 'event-driven', 'async pipeline'],
  concern1: ['authentication', 'authorization', 'rate limiting'],
  concern2: ['logging', 'metrics', 'tracing'],
  concern3: ['error handling', 'retry logic', 'circuit breaking'],
  pattern: ['repository', 'CQRS', 'event sourcing', 'saga', 'port-adapter'],
  abstraction: ['repository', 'gateway', 'adapter', 'facade'],
  observability: ['structured logging', 'distributed tracing', 'health checks'],
};

function fillTemplate(template) {
  const vars = {};
  for (const [key, values] of Object.entries(VARS)) {
    vars[key] = randomChoice(values);
  }
  return template(vars);
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  const corpus = [];
  const TARGET = 2000;

  // Generate flat examples
  for (let i = 0; i < TARGET / 2; i++) {
    const template = randomChoice(FLAT_PATTERNS);
    const input = fillTemplate(template);
    corpus.push({ input: `<task>${input}</task>`, output: 'flat' });
  }

  // Generate unified-memory examples
  for (let i = 0; i < TARGET / 2; i++) {
    const template = randomChoice(UNIFIED_MEMORY_PATTERNS);
    const input = fillTemplate(template);
    corpus.push({ input: `<task>${input}</task>`, output: 'unified-memory' });
  }

  console.log(`Generated ${corpus.length} pairs (${TARGET/2} flat + ${TARGET/2} unified-memory)`);

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

  console.log(`Wrote ${train.length} train + ${holdout.length} holdout to ${outDir}/`);
}

main();
