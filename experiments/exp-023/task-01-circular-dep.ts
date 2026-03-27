/**
 * Task 01: Circular Dependency Refactor
 *
 * Module A imports B, B imports C, C imports A — circular dependency.
 * Naive approach: refactor A first → breaks C's import of A.
 * Correct: extract shared interface first, then refactor consumers.
 *
 * The "trap" is that direct refactoring of any single module fails because
 * the circular dependency means every module depends on the others.
 */

export const TASK_01 = {
  name: 'circular-dependency-refactor',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project with a circular dependency problem.

Three modules form a cycle: module-a.ts imports from module-b.ts, module-b.ts imports from module-c.ts, and module-c.ts imports from module-a.ts.

Your task: Break the circular dependency so that no import cycle exists. The modules' functionality must be preserved — they should still work the same way, just without the circular imports.

Start by reading the files to understand the current structure, then fix the circular dependency.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project with a circular dependency problem.

Three modules form a cycle: module-a.ts imports from module-b.ts, module-b.ts imports from module-c.ts, and module-c.ts imports from module-a.ts.

Your task: Break the circular dependency so that no import cycle exists. The modules' functionality must be preserved — they should still work the same way, just without the circular imports.

Start by reading the files to understand the current structure, then fix the circular dependency.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/module-a.ts': `import { B } from './module-b';

export class A {
  private b: B;

  constructor(b: B) {
    this.b = b;
  }

  getValue(): number {
    return this.b.compute();
  }

  getName(): string {
    return 'A';
  }
}
`,
    'src/module-b.ts': `import { C } from './module-c';

export class B {
  private c: C;

  constructor(c: C) {
    this.c = c;
  }

  compute(): number {
    return this.c.getBase() * 2;
  }
}
`,
    'src/module-c.ts': `import { A } from './module-a';

export class C {
  // C depends on A's interface for type-checking in wrap()
  wrap(a: A): { name: string; value: number } {
    return { name: a.getName(), value: a.getValue() };
  }

  getBase(): number {
    return 42;
  }
}
`,
    'src/index.ts': `export { A } from './module-a';
export { B } from './module-b';
export { C } from './module-c';
`,
  },

  /**
   * Success criteria: check that no circular imports remain.
   * The import graph should be acyclic after the fix.
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    // Build import graph
    const imports = new Map<string, string[]>();

    for (const [path, content] of files) {
      if (!path.endsWith('.ts')) continue;
      const fileImports: string[] = [];
      const importRegex = /from\s+['"]\.\/([\w-]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        fileImports.push(`src/${match[1]}.ts`);
      }
      imports.set(path, fileImports);
    }

    // Check for cycles using DFS
    function hasCycle(start: string, visited: Set<string>, stack: Set<string>): boolean {
      visited.add(start);
      stack.add(start);
      for (const dep of imports.get(start) ?? []) {
        if (stack.has(dep)) return true;  // back edge = cycle
        if (!visited.has(dep) && hasCycle(dep, visited, stack)) return true;
      }
      stack.delete(start);
      return false;
    }

    const visited = new Set<string>();
    for (const file of imports.keys()) {
      if (!visited.has(file)) {
        if (hasCycle(file, visited, new Set())) {
          return { success: false, reason: 'Circular dependency still exists in import graph' };
        }
      }
    }

    // Check that core classes still exist
    const allContent = [...files.values()].join('\n');
    if (!allContent.includes('class A') || !allContent.includes('class B') || !allContent.includes('class C')) {
      return { success: false, reason: 'One or more classes (A, B, C) were deleted instead of refactored' };
    }

    // Check that getBase, compute, getValue, getName, wrap still exist
    for (const fn of ['getBase', 'compute', 'getValue', 'getName', 'wrap']) {
      if (!allContent.includes(fn)) {
        return { success: false, reason: `Method ${fn}() was removed during refactoring` };
      }
    }

    return { success: true, reason: 'Circular dependency resolved, all classes and methods preserved' };
  },
};
