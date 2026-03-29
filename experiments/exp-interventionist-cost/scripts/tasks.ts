/**
 * Task Suite for exp-interventionist-cost
 *
 * 6 tasks across 3 difficulty tiers, plus 2 error-injected variants of Tier 3 tasks.
 * Stratification is critical: the interventionist pattern's value is proven by showing
 * it pays monitoring costs only when needed (Tier 3), not on easy tasks (Tier 1).
 */

// ── Task Interface ────────────────────────────────────────────────

export interface TaskDefinition {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Whether this variant has an injected error for detection measurement. */
  hasInjectedError: boolean;
  /** Description shown to the cognitive agent. */
  description: string;
  /** Base description for flat/baseline conditions (no "done" signal). */
  baseDescription: string;
  /** Initial file contents. */
  initialFiles: Record<string, string>;
  /** Validate whether the task was completed correctly. */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
  /** For injected-error tasks: describe the injected error for analysis. */
  injectedErrorDescription?: string;
}

// ── Tier 1: Easy (monitoring unnecessary) ─────────────────────────

export const TASK_SIMPLE_RENAME: TaskDefinition = {
  id: 'simple-rename',
  name: 'Simple Function Rename',
  tier: 1,
  hasInjectedError: false,
  baseDescription: `Rename the function \`calculateTotal\` to \`computeSum\` in all files. There are 3 files: math.ts (definition), app.ts (usage), and test.ts (test usage). Preserve all functionality.`,
  description: `Rename the function \`calculateTotal\` to \`computeSum\` in all files. There are 3 files: math.ts (definition), app.ts (usage), and test.ts (test usage). Preserve all functionality.\n\nWhen you are done, signal completion with the "done" action.`,
  initialFiles: {
    'src/math.ts': `export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}

export function formatCurrency(amount: number): string {
  return \`$\${amount.toFixed(2)}\`;
}
`,
    'src/app.ts': `import { calculateTotal, formatCurrency } from './math';

export function processOrder(prices: number[]): string {
  const total = calculateTotal(prices);
  return formatCurrency(total);
}
`,
    'src/test.ts': `import { calculateTotal } from './math';

function testCalculateTotal() {
  const result = calculateTotal([1, 2, 3]);
  console.assert(result === 6, 'Expected 6');
}

testCalculateTotal();
`,
  },
  validate(files) {
    const math = files.get('src/math.ts') ?? '';
    const app = files.get('src/app.ts') ?? '';
    const test = files.get('src/test.ts') ?? '';

    if (math.includes('calculateTotal')) return { success: false, reason: 'math.ts still contains calculateTotal' };
    if (!math.includes('computeSum')) return { success: false, reason: 'math.ts missing computeSum' };
    if (app.includes('calculateTotal')) return { success: false, reason: 'app.ts still contains calculateTotal' };
    if (!app.includes('computeSum')) return { success: false, reason: 'app.ts missing computeSum' };
    if (test.includes('calculateTotal')) return { success: false, reason: 'test.ts still contains calculateTotal' };
    if (!test.includes('computeSum')) return { success: false, reason: 'test.ts missing computeSum' };
    if (!math.includes('formatCurrency')) return { success: false, reason: 'formatCurrency was incorrectly modified' };

    return { success: true, reason: 'All references renamed correctly' };
  },
};

export const TASK_ADD_FIELD: TaskDefinition = {
  id: 'add-field',
  name: 'Add Interface Field',
  tier: 1,
  hasInjectedError: false,
  baseDescription: `Add a \`createdAt: Date\` field to the \`User\` interface in types.ts. Update the two consumers (service.ts and handler.ts) to populate this field. In service.ts, set createdAt to \`new Date()\`. In handler.ts, include createdAt in the response object.`,
  description: `Add a \`createdAt: Date\` field to the \`User\` interface in types.ts. Update the two consumers (service.ts and handler.ts) to populate this field. In service.ts, set createdAt to \`new Date()\`. In handler.ts, include createdAt in the response object.\n\nWhen you are done, signal completion with the "done" action.`,
  initialFiles: {
    'src/types.ts': `export interface User {
  id: string;
  name: string;
  email: string;
}
`,
    'src/service.ts': `import type { User } from './types';

export function createUser(name: string, email: string): User {
  return {
    id: Math.random().toString(36).slice(2),
    name,
    email,
  };
}
`,
    'src/handler.ts': `import type { User } from './types';
import { createUser } from './service';

export function handleCreateUser(name: string, email: string): { user: User; status: number } {
  const user = createUser(name, email);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    status: 201,
  };
}
`,
  },
  validate(files) {
    const types = files.get('src/types.ts') ?? '';
    const service = files.get('src/service.ts') ?? '';
    const handler = files.get('src/handler.ts') ?? '';

    if (!types.includes('createdAt')) return { success: false, reason: 'types.ts missing createdAt field' };
    if (!types.includes('Date')) return { success: false, reason: 'types.ts createdAt not typed as Date' };
    if (!service.includes('createdAt')) return { success: false, reason: 'service.ts does not populate createdAt' };
    if (!service.includes('new Date')) return { success: false, reason: 'service.ts does not use new Date()' };
    if (!handler.includes('createdAt')) return { success: false, reason: 'handler.ts does not include createdAt' };

    return { success: true, reason: 'Field added and consumers updated' };
  },
};

// ── Tier 2: Medium (monitoring occasionally helpful) ──────────────

export const TASK_CONFIG_MIGRATION: TaskDefinition = {
  id: 'config-migration',
  name: 'Config Format Migration',
  tier: 2,
  hasInjectedError: false,
  baseDescription: `Migrate the config from v1 format (config-v1.json) to v2 format (config-v2.json). The migration rules are:
- "host" and "port" merge into "url" as "http://{host}:{port}"
- "debug" boolean becomes "logLevel": "debug" if true, "info" if false
- "retries" stays the same
- "timeout" in seconds becomes "timeoutMs" in milliseconds
Write the result to config-v2.json and update loader.ts to use the new format.`,
  description: `Migrate the config from v1 format (config-v1.json) to v2 format (config-v2.json). The migration rules are:
- "host" and "port" merge into "url" as "http://{host}:{port}"
- "debug" boolean becomes "logLevel": "debug" if true, "info" if false
- "retries" stays the same
- "timeout" in seconds becomes "timeoutMs" in milliseconds
Write the result to config-v2.json and update loader.ts to use the new format.

When you are done, signal completion with the "done" action.`,
  initialFiles: {
    'config-v1.json': JSON.stringify({
      host: 'localhost',
      port: 3000,
      debug: true,
      retries: 3,
      timeout: 30,
    }, null, 2),
    'loader.ts': `import config from './config-v1.json';

export function getUrl(): string {
  return \`http://\${config.host}:\${config.port}\`;
}

export function getRetries(): number {
  return config.retries;
}

export function isDebug(): boolean {
  return config.debug;
}
`,
  },
  validate(files) {
    const v2Raw = files.get('config-v2.json') ?? '';
    const loader = files.get('loader.ts') ?? '';

    if (!v2Raw) return { success: false, reason: 'config-v2.json not created' };

    let v2: Record<string, unknown>;
    try {
      v2 = JSON.parse(v2Raw);
    } catch {
      return { success: false, reason: 'config-v2.json is not valid JSON' };
    }

    if (v2.url !== 'http://localhost:3000') return { success: false, reason: `url should be "http://localhost:3000", got "${v2.url}"` };
    if (v2.logLevel !== 'debug') return { success: false, reason: `logLevel should be "debug", got "${v2.logLevel}"` };
    if (v2.retries !== 3) return { success: false, reason: `retries should be 3, got ${v2.retries}` };
    if (v2.timeoutMs !== 30000) return { success: false, reason: `timeoutMs should be 30000, got ${v2.timeoutMs}` };
    if (loader.includes('config-v1')) return { success: false, reason: 'loader.ts still references config-v1' };

    return { success: true, reason: 'Config migrated and loader updated' };
  },
};

export const TASK_TYPE_NARROWING: TaskDefinition = {
  id: 'type-narrowing',
  name: 'Type Narrowing Bug Fix',
  tier: 2,
  hasInjectedError: false,
  baseDescription: `Fix the type error in processor.ts. The \`processItem\` function receives a \`string | number\` but the handler functions expect specific types. The obvious fix (type assertion with \`as\`) will compile but is incorrect -- it doesn't actually check the type at runtime. Use a proper type guard instead.`,
  description: `Fix the type error in processor.ts. The \`processItem\` function receives a \`string | number\` but the handler functions expect specific types. The obvious fix (type assertion with \`as\`) will compile but is incorrect -- it doesn't actually check the type at runtime. Use a proper type guard instead.

When you are done, signal completion with the "done" action.`,
  initialFiles: {
    'src/processor.ts': `export function handleString(value: string): string {
  return value.toUpperCase();
}

export function handleNumber(value: number): number {
  return value * 2;
}

export function processItem(item: string | number): string | number {
  // BUG: This doesn't work -- TypeScript can't narrow the type here
  // because the condition is always true (both string and number are truthy for non-zero/empty)
  if (item) {
    return handleString(item);  // Type error: number is not assignable to string
  }
  return handleNumber(item);    // Type error: string is not assignable to number
}
`,
    'src/runner.ts': `import { processItem } from './processor';

const results = [
  processItem('hello'),
  processItem(42),
  processItem('world'),
  processItem(0),
];

console.log(results);
`,
  },
  validate(files) {
    const processor = files.get('src/processor.ts') ?? '';

    // Must use typeof check (proper type guard), not 'as' assertion
    if (processor.includes(' as string') || processor.includes(' as number')) {
      return { success: false, reason: 'Used type assertion (as) instead of proper type guard' };
    }
    if (!processor.includes('typeof')) {
      return { success: false, reason: 'Missing typeof type guard' };
    }
    if (!processor.includes('handleString') || !processor.includes('handleNumber')) {
      return { success: false, reason: 'Handler functions were removed instead of fixing the narrowing' };
    }

    return { success: true, reason: 'Type narrowing fixed with proper type guard' };
  },
};

// ── Tier 3: Hard (monitoring catches errors) ──────────────────────

export const TASK_CIRCULAR_DEP: TaskDefinition = {
  id: 'circular-dep',
  name: 'Circular Dependency Break',
  tier: 3,
  hasInjectedError: false,
  baseDescription: `Three TypeScript modules form a circular dependency: module-a.ts imports from module-b.ts, module-b.ts imports from module-c.ts, and module-c.ts imports from module-a.ts.

Break the circular dependency so that no import cycle exists. All modules' functionality must be preserved -- they should still work the same way, just without the circular imports.

Read all files first to understand the structure before making changes.`,
  description: `Three TypeScript modules form a circular dependency: module-a.ts imports from module-b.ts, module-b.ts imports from module-c.ts, and module-c.ts imports from module-a.ts.

Break the circular dependency so that no import cycle exists. All modules' functionality must be preserved -- they should still work the same way, just without the circular imports.

Read all files first to understand the structure before making changes.

When you are done, signal completion with the "done" action.`,
  initialFiles: {
    'src/module-a.ts': `import { B } from './module-b';

export class A {
  private b: B;
  constructor(b: B) { this.b = b; }
  getValue(): number { return this.b.compute(); }
  getName(): string { return 'A'; }
}
`,
    'src/module-b.ts': `import { C } from './module-c';

export class B {
  private c: C;
  constructor(c: C) { this.c = c; }
  compute(): number { return this.c.fetch() * 2; }
  getLabel(): string { return 'B'; }
}
`,
    'src/module-c.ts': `import { A } from './module-a';

export class C {
  private a: A;
  constructor(a: A) { this.a = a; }
  fetch(): number { return 42; }
  describe(): string { return \`C wraps \${this.a.getName()}\`; }
}
`,
  },
  validate(files) {
    const a = files.get('src/module-a.ts') ?? '';
    const b = files.get('src/module-b.ts') ?? '';
    const c = files.get('src/module-c.ts') ?? '';

    // Check functionality is preserved
    if (!a.includes('getValue') || !a.includes('getName')) {
      return { success: false, reason: 'module-a.ts lost functionality' };
    }
    if (!b.includes('compute') || !b.includes('getLabel')) {
      return { success: false, reason: 'module-b.ts lost functionality' };
    }
    if (!c.includes('fetch') || !c.includes('describe')) {
      return { success: false, reason: 'module-c.ts lost functionality' };
    }

    // Check circular dependency is broken
    // At least one of the three circular imports must be removed/rerouted
    const aImportsB = a.includes("from './module-b'") || a.includes('from "./module-b"');
    const bImportsC = b.includes("from './module-c'") || b.includes('from "./module-c"');
    const cImportsA = c.includes("from './module-a'") || c.includes('from "./module-a"');

    if (aImportsB && bImportsC && cImportsA) {
      return { success: false, reason: 'Circular dependency still exists (A->B->C->A)' };
    }

    return { success: true, reason: 'Circular dependency broken, functionality preserved' };
  },
};

export const TASK_DEAD_CODE_TRAP: TaskDefinition = {
  id: 'dead-code-trap',
  name: 'Dead Code Removal with Hidden Dynamic Dispatch',
  tier: 3,
  hasInjectedError: false,
  baseDescription: `Remove all dead code from utils.ts. Functions that are not called anywhere in the codebase should be removed. Be careful to check for dynamic references (bracket notation, string-based lookups) before removing anything.

Files: utils.ts (utility functions), app.ts (main consumer), plugin.ts (plugin system).`,
  description: `Remove all dead code from utils.ts. Functions that are not called anywhere in the codebase should be removed. Be careful to check for dynamic references (bracket notation, string-based lookups) before removing anything.

Files: utils.ts (utility functions), app.ts (main consumer), plugin.ts (plugin system).

When you are done, signal completion with the "done" action.`,
  initialFiles: {
    'src/utils.ts': `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/\\s+/g, '-');
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function deprecated_oldParser(input: string): string[] {
  return input.split(',');
}

export function unused_helper(): void {
  console.log('never called');
}
`,
    'src/app.ts': `import { formatDate, capitalize } from './utils';

export function renderHeader(name: string, date: Date): string {
  return \`\${capitalize(name)} - \${formatDate(date)}\`;
}
`,
    'src/plugin.ts': `import * as utils from './utils';

type TransformFn = (input: string) => string;

const TRANSFORMS: Record<string, string> = {
  'title': 'capitalize',
  'url': 'slugify',
  'preview': 'truncate',
};

export function applyTransform(name: string, input: string): string {
  const fnName = TRANSFORMS[name];
  if (!fnName) throw new Error(\`Unknown transform: \${name}\`);
  const fn = (utils as Record<string, unknown>)[fnName] as TransformFn | undefined;
  if (!fn) throw new Error(\`Transform function not found: \${fnName}\`);
  return fn(input);
}
`,
  },
  validate(files) {
    const utils = files.get('src/utils.ts') ?? '';

    // Should keep: formatDate (direct import), capitalize (direct + dynamic),
    //              slugify (dynamic), truncate (dynamic)
    // Should remove: deprecated_oldParser, unused_helper

    if (!utils.includes('formatDate')) return { success: false, reason: 'Removed formatDate (used in app.ts)' };
    if (!utils.includes('capitalize')) return { success: false, reason: 'Removed capitalize (used in app.ts and plugin.ts dynamic)' };
    if (!utils.includes('slugify')) return { success: false, reason: 'Removed slugify (used via dynamic dispatch in plugin.ts)' };
    if (!utils.includes('truncate')) return { success: false, reason: 'Removed truncate (used via dynamic dispatch in plugin.ts)' };

    if (utils.includes('deprecated_oldParser')) return { success: false, reason: 'Failed to remove deprecated_oldParser (truly dead)' };
    if (utils.includes('unused_helper')) return { success: false, reason: 'Failed to remove unused_helper (truly dead)' };

    return { success: true, reason: 'Correctly identified dynamic dispatch, removed only truly dead code' };
  },
};

// ── Tier 3 Injected Error Variants ────────────────────────────────

export const TASK_CIRCULAR_DEP_INJECTED: TaskDefinition = {
  ...TASK_CIRCULAR_DEP,
  id: 'circular-dep-injected',
  name: 'Circular Dependency Break (Injected Type Error)',
  hasInjectedError: true,
  injectedErrorDescription: 'module-b.ts compute() returns a string concatenation instead of numeric multiplication. The type annotation says number but the runtime value is a string.',
  initialFiles: {
    ...TASK_CIRCULAR_DEP.initialFiles,
    // Override module-b with injected type error
    'src/module-b.ts': `import { C } from './module-c';

export class B {
  private c: C;
  constructor(c: C) { this.c = c; }
  compute(): number {
    // BUG: string concatenation instead of multiplication
    // Returns "422" (string) instead of 84 (number)
    return this.c.fetch() + '2' as unknown as number;
  }
  getLabel(): string { return 'B'; }
}
`,
  },
  validate(files) {
    const baseResult = TASK_CIRCULAR_DEP.validate(files);
    if (!baseResult.success) return baseResult;

    const b = files.get('src/module-b.ts') ?? '';
    // Check if the injected error was also fixed
    if (b.includes("+ '2'") || b.includes('as unknown as number')) {
      return { success: false, reason: 'Injected type error not fixed (string concatenation in compute)' };
    }
    return { success: true, reason: 'Circular dep broken and injected error fixed' };
  },
};

export const TASK_DEAD_CODE_TRAP_INJECTED: TaskDefinition = {
  ...TASK_DEAD_CODE_TRAP,
  id: 'dead-code-trap-injected',
  name: 'Dead Code Removal (Injected Side Effect)',
  hasInjectedError: true,
  injectedErrorDescription: 'deprecated_oldParser has a hidden side effect -- it writes to a module-level cache that formatDate reads. Removing it silently breaks formatDate.',
  initialFiles: {
    'src/utils.ts': `// Module-level shared state
let _dateCache: Map<string, string> | null = null;

export function formatDate(date: Date): string {
  if (_dateCache) {
    const cached = _dateCache.get(date.toISOString());
    if (cached) return cached;
  }
  const result = date.toISOString().split('T')[0];
  _dateCache?.set(date.toISOString(), result);
  return result;
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/\\s+/g, '-');
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function deprecated_oldParser(input: string): string[] {
  // SIDE EFFECT: initializes the date cache used by formatDate
  if (!_dateCache) _dateCache = new Map();
  return input.split(',');
}

export function unused_helper(): void {
  console.log('never called');
}
`,
    'src/app.ts': TASK_DEAD_CODE_TRAP.initialFiles['src/app.ts'],
    'src/plugin.ts': TASK_DEAD_CODE_TRAP.initialFiles['src/plugin.ts'],
  },
  validate(files) {
    const utils = files.get('src/utils.ts') ?? '';

    // The correct action: recognize the side effect and either:
    // 1. Keep deprecated_oldParser but mark it, OR
    // 2. Remove it AND refactor formatDate to not depend on _dateCache, OR
    // 3. Extract the cache init into formatDate itself

    if (!utils.includes('formatDate')) return { success: false, reason: 'Removed formatDate' };
    if (!utils.includes('capitalize')) return { success: false, reason: 'Removed capitalize' };
    if (!utils.includes('slugify')) return { success: false, reason: 'Removed slugify' };
    if (!utils.includes('truncate')) return { success: false, reason: 'Removed truncate' };
    if (utils.includes('unused_helper')) return { success: false, reason: 'Failed to remove unused_helper' };

    // If deprecated_oldParser was removed, check that the side effect was handled
    if (!utils.includes('deprecated_oldParser')) {
      // Cache init must be moved to formatDate or removed entirely
      if (utils.includes('_dateCache') && !utils.includes('new Map')) {
        return { success: false, reason: 'Removed deprecated_oldParser without handling cache initialization side effect' };
      }
    }

    return { success: true, reason: 'Dead code handled correctly (side effect managed)' };
  },
};

// ── Task Registry ─────────────────────────────────────────────────

export const ALL_TASKS: TaskDefinition[] = [
  // Tier 1
  TASK_SIMPLE_RENAME,
  TASK_ADD_FIELD,
  // Tier 2
  TASK_CONFIG_MIGRATION,
  TASK_TYPE_NARROWING,
  // Tier 3
  TASK_CIRCULAR_DEP,
  TASK_DEAD_CODE_TRAP,
  // Tier 3 + injected errors
  TASK_CIRCULAR_DEP_INJECTED,
  TASK_DEAD_CODE_TRAP_INJECTED,
];

export const TASKS_BY_TIER: Record<number, TaskDefinition[]> = {
  1: [TASK_SIMPLE_RENAME, TASK_ADD_FIELD],
  2: [TASK_CONFIG_MIGRATION, TASK_TYPE_NARROWING],
  3: [TASK_CIRCULAR_DEP, TASK_DEAD_CODE_TRAP, TASK_CIRCULAR_DEP_INJECTED, TASK_DEAD_CODE_TRAP_INJECTED],
};

export function getTaskById(id: string): TaskDefinition | undefined {
  return ALL_TASKS.find(t => t.id === id);
}
