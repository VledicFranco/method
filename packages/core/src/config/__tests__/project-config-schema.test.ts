/**
 * Tests for project-config-schema
 * F-PRAGMA-4: Configuration validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ProjectConfigSchema,
  validateProjectConfig,
  validateProjectConfigSafe,
} from '../project-config-schema.js';

// ── Valid Configuration Tests ────

test('Minimal valid config: id and name only', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
  };

  const result = validateProjectConfig(config);

  assert.strictEqual(result.id, 'my-project');
  assert.strictEqual(result.name, 'My Project');
});

test('Full valid config: all fields', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    description: 'A test project',
    owner: 'alice@example.com',
    version: '1.0.0',
    dependencies: [
      { project_id: 'dep-1', version_constraint: '^1.0.0' },
    ],
    shared_with: ['bob@example.com', 'team-c'],
  };

  const result = validateProjectConfig(config);

  assert.strictEqual(result.id, 'my-project');
  assert.strictEqual(result.name, 'My Project');
  assert.strictEqual(result.description, 'A test project');
  assert.strictEqual(result.owner, 'alice@example.com');
  assert.strictEqual(result.version, '1.0.0');
  assert.strictEqual(result.dependencies?.length, 1);
  assert.strictEqual(result.shared_with?.length, 2);
});

// ── Invalid Configuration Tests ────

test('Invalid: missing required id', () => {
  const config = {
    name: 'My Project',
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: missing required name', () => {
  const config = {
    id: 'my-project',
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: id contains uppercase', () => {
  const config = {
    id: 'My-Project',
    name: 'My Project',
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: id contains spaces', () => {
  const config = {
    id: 'my project',
    name: 'My Project',
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: name exceeds max length', () => {
  const config = {
    id: 'my-project',
    name: 'x'.repeat(201),
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: description exceeds max length', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    description: 'x'.repeat(501),
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: version not semantic', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    version: '1.0',
  };

  assert.throws(() => validateProjectConfig(config));
});

test('Invalid: additional unknown properties rejected', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    unknown_field: 'should fail',
  } as any;

  assert.throws(() => validateProjectConfig(config));
});

// ── Safe Validation (Non-Throwing) Tests ────

test('Safe validation: returns valid true for good config', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
  };

  const result = validateProjectConfigSafe(config);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.data?.id, 'my-project');
  assert.strictEqual(result.errors, undefined);
});

test('Safe validation: handles invalid config without throwing', () => {
  const config = {
    id: 'my-project',
    name: 'x'.repeat(201), // name too long
  };

  // Should not throw, should return invalid result
  const result = validateProjectConfigSafe(config);

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.data, undefined);
  assert(Array.isArray(result.errors), 'Errors should be an array');
});

test('Safe validation: missing required field', () => {
  const config = {
    id: 'my-project',
    // missing required name
  };

  const result = validateProjectConfigSafe(config);

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.data, undefined);
  assert(Array.isArray(result.errors), 'Errors should be an array');
});

test('Safe validation: errors array format', () => {
  const config = {
    id: 'my-project',
    name: 'x'.repeat(201), // name too long
  };

  const result = validateProjectConfigSafe(config);

  assert.strictEqual(result.valid, false);
  assert(Array.isArray(result.errors), 'Should have errors array');
});

// ── Edge Cases ────

test('Empty strings for optional fields are valid', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    description: '', // empty optional string
    owner: '', // empty optional string
  };

  // Empty strings for optional fields should be valid (Zod allows them)
  const result = validateProjectConfigSafe(config);
  assert.strictEqual(result.valid, true);
});

test('Empty dependencies array is valid', () => {
  const config = {
    id: 'my-project',
    name: 'My Project',
    dependencies: [],
  };

  const result = validateProjectConfig(config);

  assert.strictEqual(result.dependencies?.length, 0);
});

test('Project ID with hyphens and underscores valid', () => {
  const validIds = [
    'my-project',
    'my_project',
    'my-proj_123',
    'a',
    '123',
  ];

  validIds.forEach((id) => {
    const config = {
      id,
      name: 'Test',
    };

    const result = validateProjectConfig(config);
    assert.strictEqual(result.id, id);
  });
});

test('Project ID with special chars invalid', () => {
  const invalidIds = [
    'my.project',
    'my@project',
    'my project',
    'my/project',
    'my\\project',
    'my:project',
  ];

  invalidIds.forEach((id) => {
    const config = {
      id,
      name: 'Test',
    };

    assert.throws(() => validateProjectConfig(config), /lowercase/i);
  });
});
