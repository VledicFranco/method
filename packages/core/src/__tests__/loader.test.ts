/**
 * loader.test.ts — Edge case tests for loadMethodology and listMethodologies
 *
 * Covers: readYaml error paths, extractPhases edge cases, fallback path logic,
 * extractString with non-string values, listMethodologies with empty/malformed dirs,
 * and one integration test loading real registry YAML (DR-09).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'path';
import { loadMethodology, listMethodologies } from '../index.js';
import type { CoreFileSystem } from '../index.js';

// ── Helpers ──

/** Build a minimal in-memory CoreFileSystem mock. */
function mockFs(files: Record<string, string>, dirs?: Record<string, Array<{ name: string; isDirectory(): boolean }>>): CoreFileSystem {
  return {
    readFileSync(path: string, _encoding: 'utf-8'): string {
      if (!(path in files)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[path];
    },
    readdirSync(path: string, _options: { withFileTypes: true }) {
      if (dirs && path in dirs) return dirs[path];
      // Default: empty directory
      return [];
    },
    existsSync(path: string): boolean {
      return path in files;
    },
  };
}

const REG = '/fake/registry';

// ── readYaml edge cases ──

describe('readYaml — null/empty YAML', () => {
  it('throws when YAML content is empty (yaml.load returns undefined)', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: '',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('YAML did not produce an object'),
    );
  });

  it('throws when YAML content is "null" literal', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: 'null',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('YAML did not produce an object'),
    );
  });
});

describe('readYaml — scalar YAML', () => {
  it('throws when YAML produces a scalar string', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: 'hello world',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('YAML did not produce an object'),
    );
  });

  it('throws when YAML produces a number', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: '42',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('YAML did not produce an object'),
    );
  });
});

describe('readYaml — malformed YAML', () => {
  it('throws "Failed to parse" when YAML syntax is invalid', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: ':\n  bad:\n    - [unterminated',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('Failed to parse'),
    );
  });
});

describe('readYaml — missing file (ENOENT)', () => {
  it('throws "Failed to parse" wrapping ENOENT when file exists for existsSync but readFileSync fails', () => {
    // Simulate: existsSync returns true (file appears to exist) but readFileSync throws
    const fs: CoreFileSystem = {
      readFileSync(_path: string, _encoding: 'utf-8'): string {
        const err: NodeJS.ErrnoException = new Error('ENOENT: no such file');
        err.code = 'ENOENT';
        throw err;
      },
      readdirSync() { return []; },
      existsSync() { return true; },
    };
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('Failed to parse'),
    );
  });
});

// ── extractPhases edge cases ──

describe('extractPhases — empty phases array', () => {
  it('throws "has no steps defined" when phases is an empty array', () => {
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: 'phases: []\nmethod:\n  name: Test\n',
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('has no steps defined'),
    );
  });
});

describe('extractPhases — missing required fields', () => {
  it('throws when phase is missing id field', () => {
    const yaml = `
phases:
  - name: "Step One"
    role: agent
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes("Phase missing required 'id' field"),
    );
  });

  it('throws when phase is missing name field', () => {
    const yaml = `
phases:
  - id: step_1
    role: agent
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes("Phase missing required 'name' field"),
    );
  });

  it('throws when id is a number instead of string', () => {
    const yaml = `
phases:
  - id: 123
    name: "Step One"
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes("Phase missing required 'id' field"),
    );
  });
});

describe('extractPhases — no phases key at all', () => {
  it('throws "has no phases" when YAML has neither phases nor method.phases', () => {
    const yaml = `
method:
  name: Test
  description: No phases here
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('has no phases'),
    );
  });
});

describe('extractPhases — phases nested under method', () => {
  it('reads phases from method.phases as fallback', () => {
    const yaml = `
method:
  name: Nested Test
  phases:
    - id: step_1
      name: "Step One"
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].id, 'step_1');
  });
});

// ── Optional step fields ──

describe('extractPhases — optional fields', () => {
  it('returns null for role, precondition, postcondition, guidance when they are non-string', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step One"
    role: 42
    precondition: true
    postcondition:
      some: object
    guidance: 100
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    const step = result.steps[0];
    assert.equal(step.role, null, 'non-string role → null');
    assert.equal(step.precondition, null, 'non-string precondition → null');
    assert.equal(step.postcondition, null, 'non-string postcondition → null');
    assert.equal(step.guidance, null, 'non-string guidance → null');
  });

  it('returns null for output_schema when it is a non-object', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step One"
    output_schema: "not an object"
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.steps[0].outputSchema, null, 'string output_schema → null');
  });

  it('returns output_schema when it is an object', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step One"
    output_schema:
      type: object
      properties:
        foo:
          type: string
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.ok(result.steps[0].outputSchema !== null, 'object output_schema preserved');
    assert.equal((result.steps[0].outputSchema as Record<string, unknown>)['type'], 'object');
  });

  it('trims whitespace from precondition and postcondition strings', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step One"
    precondition: "  has spaces  "
    postcondition: "  also spaces  "
    guidance: "  guide  "
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.steps[0].precondition, 'has spaces');
    assert.equal(result.steps[0].postcondition, 'also spaces');
    assert.equal(result.steps[0].guidance, 'guide');
  });
});

// ── extractString with non-string values ──

describe('extractString — non-string values', () => {
  it('returns methodId as name when meta.name is a number', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
method:
  name: 42
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    // extractString returns null for non-string → falls back to methodId
    assert.equal(result.name, 'M1');
  });

  it('returns null for objective when objective.formal is not a string', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
method:
  name: Test
objective:
  formal: 123
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.objective, null);
  });
});

// ── Fallback path logic ──

describe('loadMethodology — fallback path logic', () => {
  it('uses fallback path when methodologyId === methodId and primary missing', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Fallback Step"
methodology:
  name: Fallback Method
`;
    const fs = mockFs({
      // No primary: REG/P1/P1/P1.yaml
      // Only fallback: REG/P1/P1.yaml
      [join(REG, 'P1', 'P1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'P1', fs);
    assert.equal(result.steps[0].name, 'Fallback Step');
    assert.equal(result.name, 'Fallback Method');
  });

  it('throws when methodologyId === methodId and both primary and fallback missing', () => {
    const fs = mockFs({});
    assert.throws(
      () => loadMethodology(REG, 'P1', 'P1', fs),
      (err: Error) => err.message.includes('Method P1 not found'),
    );
  });

  it('throws when methodologyId !== methodId and primary missing (no fallback attempted)', () => {
    const fs = mockFs({});
    assert.throws(
      () => loadMethodology(REG, 'P1', 'M1', fs),
      (err: Error) => err.message.includes('Method M1 not found'),
    );
  });
});

// ── loadMethodology — metadata extraction ──

describe('loadMethodology — metadata extraction', () => {
  it('extracts objective from objective.formal_statement', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
method:
  name: Test
objective:
  formal_statement: "Do the thing"
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.objective, 'Do the thing');
  });

  it('prefers objective.formal over objective.formal_statement', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
method:
  name: Test
objective:
  formal: "Preferred"
  formal_statement: "Secondary"
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.objective, 'Preferred');
  });

  it('returns null objective when no objective block', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
method:
  name: Test
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.objective, null);
  });

  it('uses methodology block as meta fallback', () => {
    const yaml = `
phases:
  - id: step_1
    name: "Step"
methodology:
  name: "From Methodology Block"
`;
    const fs = mockFs({
      [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml,
    });
    const result = loadMethodology(REG, 'P1', 'M1', fs);
    assert.equal(result.name, 'From Methodology Block');
  });
});

// ── listMethodologies ──

describe('listMethodologies — empty registry', () => {
  it('returns empty array when registry has no directories', () => {
    const fs = mockFs({}, {
      [REG]: [],
    });
    const result = listMethodologies(REG, fs);
    assert.deepEqual(result, []);
  });
});

describe('listMethodologies — directory with no YAML files', () => {
  it('returns methodology entry with empty methods array', () => {
    const fs = mockFs({}, {
      [REG]: [{ name: 'P1', isDirectory: () => true }],
      [join(REG, 'P1')]: [], // empty subdirectory
    });
    const result = listMethodologies(REG, fs);
    assert.equal(result.length, 1);
    assert.equal(result[0].methodologyId, 'P1');
    assert.deepEqual(result[0].methods, []);
  });
});

describe('listMethodologies — skips files (not directories) at top level', () => {
  it('ignores non-directory entries in registry root', () => {
    const fs = mockFs({}, {
      [REG]: [
        { name: 'README.md', isDirectory: () => false },
        { name: 'P1', isDirectory: () => true },
      ],
      [join(REG, 'P1')]: [],
    });
    const result = listMethodologies(REG, fs);
    assert.equal(result.length, 1);
    assert.equal(result[0].methodologyId, 'P1');
  });
});

describe('listMethodologies — skips unparseable YAML files', () => {
  it('continues past YAML files with invalid syntax', () => {
    const fs = mockFs(
      {
        [join(REG, 'P1', 'bad.yaml')]: ':\n  [unterminated',
        [join(REG, 'P1', 'good.yaml')]: `method:\n  id: M1\n  name: Good\nphases:\n  - id: s1\n    name: Step\n`,
      },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [
          { name: 'bad.yaml', isDirectory: () => false },
          { name: 'good.yaml', isDirectory: () => false },
        ],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result.length, 1);
    assert.equal(result[0].methods.length, 1);
    assert.equal(result[0].methods[0].methodId, 'M1');
  });
});

describe('listMethodologies — methodology-level YAML', () => {
  it('extracts methodology id, name, and description from methodology block', () => {
    const yaml = `
methodology:
  id: P1-EXEC
  name: "Execution Framework"
  description: "An execution framework"
navigation:
  what: "Navigation description"
`;
    const fs = mockFs(
      { [join(REG, 'P1', 'P1.yaml')]: yaml },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [{ name: 'P1.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methodologyId, 'P1-EXEC');
    assert.equal(result[0].name, 'Execution Framework');
    // navigation.what is preferred over methodology.description
    assert.equal(result[0].description, 'Navigation description');
  });
});

describe('listMethodologies — method-level YAML extraction', () => {
  it('extracts method id, name, description, and step count', () => {
    const yaml = `
method:
  id: M1-TEST
  name: "Test Method"
navigation:
  what: "Test nav description"
phases:
  - id: s1
    name: Step 1
  - id: s2
    name: Step 2
  - id: s3
    name: Step 3
`;
    const fs = mockFs(
      { [join(REG, 'P1', 'M1', 'M1.yaml')]: yaml },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [{ name: 'M1', isDirectory: () => true }],
        [join(REG, 'P1', 'M1')]: [{ name: 'M1.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methods.length, 1);
    assert.equal(result[0].methods[0].methodId, 'M1-TEST');
    assert.equal(result[0].methods[0].name, 'Test Method');
    assert.equal(result[0].methods[0].description, 'Test nav description');
    assert.equal(result[0].methods[0].stepCount, 3);
  });

  it('uses basename as fallback when method block has no id/name', () => {
    const yaml = `
method:
  description: "No id or name"
phases:
  - id: s1
    name: Step
`;
    const fs = mockFs(
      { [join(REG, 'P1', 'unnamed.yaml')]: yaml },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [{ name: 'unnamed.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methods[0].methodId, 'unnamed');
    assert.equal(result[0].methods[0].name, 'unnamed');
  });

  it('returns stepCount 0 when phases is not an array', () => {
    const yaml = `
method:
  id: M1
  name: "No Phases Array"
phases: "not an array"
`;
    const fs = mockFs(
      { [join(REG, 'P1', 'M1.yaml')]: yaml },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [{ name: 'M1.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methods[0].stepCount, 0);
  });
});

describe('listMethodologies — sorts results', () => {
  it('returns methodologies sorted by methodologyId', () => {
    const methodYaml = (id: string) => `method:\n  id: ${id}\n  name: "${id}"\nphases:\n  - id: s1\n    name: Step\n`;
    const fs = mockFs(
      {
        [join(REG, 'Z-LAST', 'z.yaml')]: methodYaml('Z'),
        [join(REG, 'A-FIRST', 'a.yaml')]: methodYaml('A'),
        [join(REG, 'M-MID', 'm.yaml')]: methodYaml('M'),
      },
      {
        [REG]: [
          { name: 'Z-LAST', isDirectory: () => true },
          { name: 'A-FIRST', isDirectory: () => true },
          { name: 'M-MID', isDirectory: () => true },
        ],
        [join(REG, 'Z-LAST')]: [{ name: 'z.yaml', isDirectory: () => false }],
        [join(REG, 'A-FIRST')]: [{ name: 'a.yaml', isDirectory: () => false }],
        [join(REG, 'M-MID')]: [{ name: 'm.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methodologyId, 'A-FIRST');
    assert.equal(result[1].methodologyId, 'M-MID');
    assert.equal(result[2].methodologyId, 'Z-LAST');
  });

  it('returns methods sorted by methodId within each methodology', () => {
    const methodYaml = (id: string) => `method:\n  id: ${id}\n  name: "${id}"\nphases:\n  - id: s1\n    name: Step\n`;
    const fs = mockFs(
      {
        [join(REG, 'P1', 'M3.yaml')]: methodYaml('M3'),
        [join(REG, 'P1', 'M1.yaml')]: methodYaml('M1'),
        [join(REG, 'P1', 'M2.yaml')]: methodYaml('M2'),
      },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [
          { name: 'M3.yaml', isDirectory: () => false },
          { name: 'M1.yaml', isDirectory: () => false },
          { name: 'M2.yaml', isDirectory: () => false },
        ],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result[0].methods[0].methodId, 'M1');
    assert.equal(result[0].methods[1].methodId, 'M2');
    assert.equal(result[0].methods[2].methodId, 'M3');
  });
});

describe('listMethodologies — YAML file with neither method nor methodology block', () => {
  it('skips YAML files that have no method or methodology block', () => {
    const yaml = `
some_other_key: value
data:
  foo: bar
`;
    const fs = mockFs(
      { [join(REG, 'P1', 'misc.yaml')]: yaml },
      {
        [REG]: [{ name: 'P1', isDirectory: () => true }],
        [join(REG, 'P1')]: [{ name: 'misc.yaml', isDirectory: () => false }],
      },
    );
    const result = listMethodologies(REG, fs);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].methods, []);
  });
});

// ── Integration test — real registry (DR-09) ──

describe('loadMethodology — integration with real registry (DR-09)', () => {
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
  const registryPath = resolve(projectRoot, 'registry');

  it('loads P0-META/M1-MDES from actual registry YAML', () => {
    const result = loadMethodology(registryPath, 'P0-META', 'M1-MDES');
    assert.equal(result.methodologyId, 'P0-META');
    assert.equal(result.methodId, 'M1-MDES');
    assert.equal(result.name, 'Method Design from Established Domain Knowledge');
    assert.ok(result.steps.length >= 7, `Expected >= 7 steps (sigma_0 through sigma_6), got ${result.steps.length}`);
    // Verify a known step exists
    const sigma0 = result.steps.find(s => s.id === 'sigma_0');
    assert.ok(sigma0, 'Expected to find sigma_0 step');
    assert.ok(sigma0!.name.length > 0, 'sigma_0 should have a name');
  });

  it('lists methodologies from actual registry', () => {
    const result = listMethodologies(registryPath);
    assert.ok(result.length > 0, 'Expected at least one methodology in registry');
    const p0 = result.find(m => m.methodologyId.includes('META') || m.name.includes('META'));
    assert.ok(p0, 'Expected to find a META methodology');
  });
});
