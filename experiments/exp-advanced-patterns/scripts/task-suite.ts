/**
 * Task Suite — pattern-specific tasks for exp-advanced-patterns (T06, T07, T08).
 *
 * These tasks are designed to specifically exercise PRD 032 advanced cognitive patterns:
 *   T06 — Contradictory Requirements → exercises conflict-resolver (P1)
 *   T07 — Escalating Urgency → exercises affect module (P3)
 *   T08 — Cross-Task Transfer → exercises reflector-v2 (P6) + thought patterns (P5)
 *
 * Task interface matches exp-cognitive-baseline for compatibility.
 */

// ── Task Interface ─────────────────────────────────────────────

export interface TaskDefinition {
  name: string;
  baseDescription: string;
  description: string;
  initialFiles: Record<string, string>;
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
}

// ── T06: Contradictory Requirements ────────────────────────────
//
// Two specs contradict: Spec A says "sort ascending," Spec B says "insertion order."
// Both specs reference the same function. The agent must detect the contradiction
// and implement a configurable solution.
//
// Exercises: conflict-resolver (P1), meta-composer 'conflicted' classification (P2).

export const TASK_06: TaskDefinition = {
  name: 'contradictory-requirements',

  baseDescription: `You are working on a data module that must satisfy two specifications.

Spec A (in spec-a.md): The getItems() function must return items sorted in ascending alphabetical order by name.
Spec B (in spec-b.md): The getItems() function must return items in insertion order (the order they were added).

Both specs reference the same function in data-store.ts.

Your task: Implement data-store.ts so that BOTH specs can be satisfied. You may need to make the behavior configurable. Read all files first, then implement the solution.`,

  description: `You are working on a data module that must satisfy two specifications.

Spec A (in spec-a.md): The getItems() function must return items sorted in ascending alphabetical order by name.
Spec B (in spec-b.md): The getItems() function must return items in insertion order (the order they were added).

Both specs reference the same function in data-store.ts.

Your task: Implement data-store.ts so that BOTH specs can be satisfied. You may need to make the behavior configurable. Read all files first, then implement the solution.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'spec-a.md': `# Spec A: Sorted Output

The \`getItems()\` function in \`data-store.ts\` MUST return items sorted in
ascending alphabetical order by the \`name\` field.

Example:
  addItem({ name: 'banana', value: 2 })
  addItem({ name: 'apple', value: 1 })
  getItems() → [{ name: 'apple', value: 1 }, { name: 'banana', value: 2 }]

This is required for the UI display which shows items alphabetically.
`,

    'spec-b.md': `# Spec B: Insertion Order

The \`getItems()\` function in \`data-store.ts\` MUST return items in the order
they were added (insertion order). This is critical for the audit log which
must reflect chronological order.

Example:
  addItem({ name: 'banana', value: 2 })
  addItem({ name: 'apple', value: 1 })
  getItems() → [{ name: 'banana', value: 2 }, { name: 'apple', value: 1 }]

Insertion order must be preserved exactly.
`,

    'data-store.ts': `export interface Item {
  name: string;
  value: number;
}

const items: Item[] = [];

export function addItem(item: Item): void {
  items.push(item);
}

export function getItems(): Item[] {
  // TODO: implement — must satisfy both Spec A and Spec B
  return [...items];
}
`,

    'test.ts': `import { addItem, getItems } from './data-store';

// Spec A test: sorted output
function testSortedOutput() {
  addItem({ name: 'banana', value: 2 });
  addItem({ name: 'apple', value: 1 });
  addItem({ name: 'cherry', value: 3 });

  const sorted = getItems({ sort: 'alphabetical' });
  console.assert(sorted[0].name === 'apple', 'First item should be apple');
  console.assert(sorted[1].name === 'banana', 'Second item should be banana');
  console.assert(sorted[2].name === 'cherry', 'Third item should be cherry');
}

// Spec B test: insertion order
function testInsertionOrder() {
  const ordered = getItems({ sort: 'insertion' });
  console.assert(ordered[0].name === 'banana', 'First item should be banana (inserted first)');
  console.assert(ordered[1].name === 'apple', 'Second item should be apple');
  console.assert(ordered[2].name === 'cherry', 'Third item should be cherry (inserted last)');
}
`,
  },

  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    const store = files.get('data-store.ts');
    if (!store) return { success: false, reason: 'data-store.ts not found' };

    // Must have a configurable parameter (sort option, mode, order, etc.)
    const hasConfig = /(?:sort|mode|order|option)/i.test(store);
    if (!hasConfig) {
      return { success: false, reason: 'No configurable sort/order parameter found — contradiction not resolved' };
    }

    // Must have both sorting behaviors: alphabetical/sorted AND insertion/original
    const hasSortLogic = /\.sort\s*\(/.test(store) || /sorted|alphabetic/i.test(store);
    const hasInsertionLogic = /insertion|original|push|order/i.test(store);
    if (!hasSortLogic) {
      return { success: false, reason: 'No sorting logic found — Spec A not satisfied' };
    }

    // Must still have addItem and getItems exports
    const hasAddItem = /export\s+(?:function|const)\s+addItem/.test(store);
    const hasGetItems = /export\s+(?:function|const)\s+getItems/.test(store);
    if (!hasAddItem || !hasGetItems) {
      return { success: false, reason: 'Missing addItem or getItems export' };
    }

    // getItems must accept a parameter (for configurability)
    const getItemsSignature = store.match(/getItems\s*\(([^)]*)\)/);
    if (getItemsSignature && getItemsSignature[1].trim() === '') {
      // Check if there's an overloaded or optional version
      const hasOptionalParam = /getItems\s*\(\s*(?:options|config|params|{|sort)/i.test(store);
      if (!hasOptionalParam) {
        return { success: false, reason: 'getItems() has no configurable parameter — both specs cannot be satisfied simultaneously' };
      }
    }

    return { success: true, reason: 'Configurable getItems() satisfies both Spec A (sorted) and Spec B (insertion order)' };
  },
};

// ── T07: Escalating Urgency ───────────────────────────────────
//
// Agent is refactoring a module. A simulated "test failure" is present in
// an unrelated file. The agent must fix both: the refactoring AND the test failure.
//
// Exercises: affect module (P3) urgency detection.

export const TASK_07: TaskDefinition = {
  name: 'escalating-urgency',

  baseDescription: `You have TWO tasks to complete in this project:

TASK 1 (Primary): Refactor utils.ts — extract the validation logic from the processData() function
into a separate validateInput() function in the same file. processData() should call validateInput().

TASK 2 (Urgent): There is a CRITICAL BUG in logger.ts — the formatMessage() function throws a
TypeError when called with a null message. Fix it to handle null gracefully (return '[no message]').

BOTH tasks must be completed. The test failure in logger.ts is blocking the build.
Read all files first, then fix both issues.`,

  description: `You have TWO tasks to complete in this project:

TASK 1 (Primary): Refactor utils.ts — extract the validation logic from the processData() function
into a separate validateInput() function in the same file. processData() should call validateInput().

TASK 2 (Urgent): There is a CRITICAL BUG in logger.ts — the formatMessage() function throws a
TypeError when called with a null message. Fix it to handle null gracefully (return '[no message]').

BOTH tasks must be completed. The test failure in logger.ts is blocking the build.
Read all files first, then fix both issues.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'utils.ts': `export interface DataInput {
  name: string;
  value: number;
  tags?: string[];
}

export interface ProcessResult {
  valid: boolean;
  data?: { normalizedName: string; value: number; tagCount: number };
  error?: string;
}

export function processData(input: DataInput): ProcessResult {
  // Validation logic (should be extracted to validateInput)
  if (!input.name || input.name.trim().length === 0) {
    return { valid: false, error: 'Name is required' };
  }
  if (input.value < 0 || input.value > 1000) {
    return { valid: false, error: 'Value must be between 0 and 1000' };
  }
  if (input.tags && input.tags.some(t => t.length > 50)) {
    return { valid: false, error: 'Tags must be 50 characters or less' };
  }

  // Processing logic (stays in processData)
  const normalizedName = input.name.trim().toLowerCase();
  const tagCount = input.tags?.length ?? 0;

  return {
    valid: true,
    data: { normalizedName, value: input.value, tagCount },
  };
}
`,

    'logger.ts': `export function formatMessage(message: string, level: string = 'info'): string {
  // BUG: crashes when message is null
  const timestamp = new Date().toISOString();
  const upper = message.toUpperCase();  // TypeError if message is null
  return \`[\${timestamp}] [\${level.toUpperCase()}] \${upper}\`;
}

export function log(message: string, level?: string): void {
  console.log(formatMessage(message, level));
}
`,

    'test-logger.ts': `import { formatMessage } from './logger';

// This test FAILS — formatMessage(null) throws TypeError
function testNullMessage() {
  const result = formatMessage(null as any);
  console.assert(result.includes('[no message]'), 'Should handle null message');
}

function testNormalMessage() {
  const result = formatMessage('hello', 'warn');
  console.assert(result.includes('HELLO'), 'Should uppercase the message');
  console.assert(result.includes('WARN'), 'Should include level');
}
`,
  },

  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    const utils = files.get('utils.ts');
    const logger = files.get('logger.ts');

    if (!utils) return { success: false, reason: 'utils.ts not found' };
    if (!logger) return { success: false, reason: 'logger.ts not found' };

    // Task 1: validateInput must exist as a separate function
    const hasValidateInput = /(?:export\s+)?function\s+validateInput/.test(utils);
    if (!hasValidateInput) {
      return { success: false, reason: 'Task 1 incomplete: validateInput() function not found in utils.ts' };
    }

    // Task 1: processData must call validateInput
    const processDataBody = utils.match(/function\s+processData[\s\S]*?(?=\n(?:export\s+)?function\s|\n*$)/);
    if (processDataBody) {
      const callsValidate = /validateInput\s*\(/.test(processDataBody[0]);
      if (!callsValidate) {
        return { success: false, reason: 'Task 1 incomplete: processData() does not call validateInput()' };
      }
    }

    // Task 2: formatMessage must handle null
    const handlesNull = /(?:null|!message|message\s*(?:===?\s*null|==\s*null|\?\?)|message\s*\|\||typeof\s+message)/i.test(logger);
    if (!handlesNull) {
      return { success: false, reason: 'Task 2 incomplete: formatMessage() does not handle null message' };
    }

    // Task 2: Must return '[no message]' for null input
    const hasNoMessageFallback = /\[no message\]|no message/i.test(logger);
    if (!hasNoMessageFallback) {
      return { success: false, reason: 'Task 2 incomplete: formatMessage() does not return [no message] for null' };
    }

    return { success: true, reason: 'Both tasks complete: validateInput() extracted and null handling added' };
  },
};

// ── T08: Cross-Task Transfer ──────────────────────────────────
//
// Two-phase task that tests whether reflection lessons transfer.
// Phase 1: A circular dependency variant with tight budget (5 cycles) — expected to fail.
// Phase 2: Same task type, fresh files, same memory — should succeed using lessons.
//
// Exercises: reflector-v2 (P6) + thought patterns (P5) cross-task learning.

/**
 * T08 Phase 1: Tight-budget circular dependency (variant).
 * Same structure as T01 but with different class names and a 5-cycle budget.
 * Expected to FAIL under budget, producing reflection lessons.
 */
export const TASK_08_PHASE1: TaskDefinition = {
  name: 'cross-task-transfer-phase1',

  baseDescription: `You are working on a TypeScript project with a circular dependency problem.

Three services form a cycle: auth-service.ts imports from user-service.ts, user-service.ts imports from session-service.ts, and session-service.ts imports from auth-service.ts.

Your task: Break the circular dependency. All service functionality must be preserved.

IMPORTANT: You have a very limited budget. Work efficiently.`,

  description: `You are working on a TypeScript project with a circular dependency problem.

Three services form a cycle: auth-service.ts imports from user-service.ts, user-service.ts imports from session-service.ts, and session-service.ts imports from auth-service.ts.

Your task: Break the circular dependency. All service functionality must be preserved.

IMPORTANT: You have a very limited budget. Work efficiently.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/auth-service.ts': `import { UserService } from './user-service';

export class AuthService {
  private users: UserService;

  constructor(users: UserService) {
    this.users = users;
  }

  authenticate(token: string): boolean {
    const user = this.users.findByToken(token);
    return user !== null;
  }

  getServiceName(): string {
    return 'AuthService';
  }
}
`,
    'src/user-service.ts': `import { SessionService } from './session-service';

export class UserService {
  private sessions: SessionService;

  constructor(sessions: SessionService) {
    this.sessions = sessions;
  }

  findByToken(token: string): { id: string; name: string } | null {
    const session = this.sessions.getSession(token);
    if (!session) return null;
    return { id: session.userId, name: 'user-' + session.userId };
  }
}
`,
    'src/session-service.ts': `import { AuthService } from './auth-service';

export class SessionService {
  // SessionService depends on AuthService's interface for audit logging
  audit(auth: AuthService): string {
    return \`Session audit by \${auth.getServiceName()}\`;
  }

  getSession(token: string): { userId: string; token: string } | null {
    if (token === 'valid-token') {
      return { userId: 'user-1', token };
    }
    return null;
  }
}
`,
    'src/index.ts': `export { AuthService } from './auth-service';
export { UserService } from './user-service';
export { SessionService } from './session-service';
`,
  },

  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    // Check that circular dependency is broken
    const auth = files.get('src/auth-service.ts');
    const user = files.get('src/user-service.ts');
    const session = files.get('src/session-service.ts');

    if (!auth && !user && !session) {
      return { success: false, reason: 'All source files missing' };
    }

    // Build import graph from all .ts files
    const imports = new Map<string, string[]>();
    for (const [path, content] of files) {
      if (!path.endsWith('.ts')) continue;
      const fileImports: string[] = [];
      const importRegex = /from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        fileImports.push(match[1]);
      }
      // Normalize: strip 'src/' prefix for comparison
      const normalizedPath = path.replace(/^src\//, '').replace(/\.ts$/, '');
      imports.set(normalizedPath, fileImports);
    }

    // Check for cycles using DFS
    function hasCycle(start: string, visited: Set<string>, path: Set<string>): boolean {
      if (path.has(start)) return true;
      if (visited.has(start)) return false;
      visited.add(start);
      path.add(start);
      for (const dep of imports.get(start) ?? []) {
        if (hasCycle(dep, visited, path)) return true;
      }
      path.delete(start);
      return false;
    }

    const visited = new Set<string>();
    for (const node of imports.keys()) {
      if (hasCycle(node, new Set<string>(), new Set<string>())) {
        return { success: false, reason: `Circular dependency still exists involving ${node}` };
      }
    }

    // Verify key classes still exist (functionality preserved)
    const allContent = [...files.values()].join('\n');
    const hasAuth = /class\s+AuthService/.test(allContent);
    const hasUser = /class\s+UserService/.test(allContent);
    const hasSession = /class\s+SessionService/.test(allContent);

    if (!hasAuth || !hasUser || !hasSession) {
      return { success: false, reason: 'One or more service classes missing — functionality not preserved' };
    }

    return { success: true, reason: 'Circular dependency broken, all services preserved' };
  },
};

/**
 * T08 Phase 2: Second attempt with fresh files but same memory.
 * Same circular dependency structure but different file/class content.
 * Should benefit from Phase 1 reflection lessons.
 */
export const TASK_08_PHASE2: TaskDefinition = {
  name: 'cross-task-transfer-phase2',

  baseDescription: `You are working on a TypeScript project with a circular dependency problem.

Three modules form a cycle: controller.ts imports from repository.ts, repository.ts imports from service.ts, and service.ts imports from controller.ts.

Your task: Break the circular dependency. All module functionality must be preserved.

Start by reading all files, then plan your approach before making changes.`,

  description: `You are working on a TypeScript project with a circular dependency problem.

Three modules form a cycle: controller.ts imports from repository.ts, repository.ts imports from service.ts, and service.ts imports from controller.ts.

Your task: Break the circular dependency. All module functionality must be preserved.

Start by reading all files, then plan your approach before making changes.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/controller.ts': `import { Repository } from './repository';

export class Controller {
  private repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  handleRequest(id: string): { status: string; data: unknown } {
    const record = this.repo.findById(id);
    return { status: record ? 'found' : 'not-found', data: record };
  }

  getControllerName(): string {
    return 'MainController';
  }
}
`,
    'src/repository.ts': `import { Service } from './service';

export class Repository {
  private svc: Service;

  constructor(svc: Service) {
    this.svc = svc;
  }

  findById(id: string): { id: string; processed: boolean } | null {
    const raw = this.svc.fetchRaw(id);
    if (!raw) return null;
    return { id: raw.id, processed: true };
  }
}
`,
    'src/service.ts': `import { Controller } from './controller';

export class Service {
  // Service depends on Controller's interface for logging
  logAccess(ctrl: Controller): string {
    return \`Access logged by \${ctrl.getControllerName()}\`;
  }

  fetchRaw(id: string): { id: string; raw: string } | null {
    if (id === 'test-id') {
      return { id, raw: 'test-data' };
    }
    return null;
  }
}
`,
    'src/index.ts': `export { Controller } from './controller';
export { Repository } from './repository';
export { Service } from './service';
`,
  },

  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    // Same validation logic as Phase 1 — check for cycles
    const imports = new Map<string, string[]>();
    for (const [path, content] of files) {
      if (!path.endsWith('.ts')) continue;
      const fileImports: string[] = [];
      const importRegex = /from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        fileImports.push(match[1]);
      }
      const normalizedPath = path.replace(/^src\//, '').replace(/\.ts$/, '');
      imports.set(normalizedPath, fileImports);
    }

    function hasCycle(start: string, visited: Set<string>, path: Set<string>): boolean {
      if (path.has(start)) return true;
      if (visited.has(start)) return false;
      visited.add(start);
      path.add(start);
      for (const dep of imports.get(start) ?? []) {
        if (hasCycle(dep, visited, path)) return true;
      }
      path.delete(start);
      return false;
    }

    for (const node of imports.keys()) {
      if (hasCycle(node, new Set<string>(), new Set<string>())) {
        return { success: false, reason: `Circular dependency still exists involving ${node}` };
      }
    }

    const allContent = [...files.values()].join('\n');
    const hasController = /class\s+Controller/.test(allContent);
    const hasRepository = /class\s+Repository/.test(allContent);
    const hasService = /class\s+Service/.test(allContent);

    if (!hasController || !hasRepository || !hasService) {
      return { success: false, reason: 'One or more classes missing — functionality not preserved' };
    }

    return { success: true, reason: 'Circular dependency broken, all classes preserved' };
  },
};
