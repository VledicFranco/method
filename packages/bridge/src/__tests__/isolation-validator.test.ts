/**
 * Unit tests for IsolationValidator
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultIsolationValidator } from '../validation/isolation-validator.js';
import { InMemoryProjectRegistry } from '../domains/registry/project-registry.js';
import path from 'path';

describe('IsolationValidator', () => {
  let validator: DefaultIsolationValidator;
  let registry: InMemoryProjectRegistry;

  beforeEach(async () => {
    validator = new DefaultIsolationValidator();
    registry = new InMemoryProjectRegistry(path.join(process.cwd(), 'registry'));
    await registry.initialize();
  });

  describe('validate', () => {
    describe('valid project IDs', () => {
      it('accepts simple alphanumeric project IDs', () => {
        const result = validator.validate(registry, 'proj1');
        assert.equal(result.valid, true);
        const errorCount = result.violations.filter((v) => v.severity === 'error').length;
        assert.equal(errorCount, 0);
      });

      it('accepts project IDs with hyphens', () => {
        const result = validator.validate(registry, 'my-project-name');
        assert.equal(result.valid, true);
        const errorCount = result.violations.filter((v) => v.severity === 'error').length;
        assert.equal(errorCount, 0);
      });

      it('accepts mixed case project IDs', () => {
        const result = validator.validate(registry, 'MyProject123');
        assert.equal(result.valid, true);
        const errorCount = result.violations.filter((v) => v.severity === 'error').length;
        assert.equal(errorCount, 0);
      });

      it('accepts single character project IDs', () => {
        const result = validator.validate(registry, 'a');
        assert.equal(result.valid, true);
        const errorCount = result.violations.filter((v) => v.severity === 'error').length;
        assert.equal(errorCount, 0);
      });
    });

    describe('invalid project IDs', () => {
      it('rejects empty project ID', () => {
        const result = validator.validate(registry, '');
        assert.equal(result.valid, false);
        const errors = result.violations.filter((v) => v.severity === 'error');
        assert.ok(errors.length > 0);
      });

      it('rejects project ID with leading hyphen', () => {
        const result = validator.validate(registry, '-project');
        assert.equal(result.valid, false);
        assert.equal(result.violations.filter((v) => v.severity === 'error').length, 1);
      });

      it('rejects project ID with trailing hyphen', () => {
        const result = validator.validate(registry, 'project-');
        assert.equal(result.valid, false);
        assert.equal(result.violations.filter((v) => v.severity === 'error').length, 1);
      });

      it('rejects project ID with invalid characters', () => {
        const result = validator.validate(registry, 'project!@#');
        assert.equal(result.valid, false);
        assert.equal(result.violations.filter((v) => v.severity === 'error').length, 1);
      });

      it('rejects project ID with spaces', () => {
        const result = validator.validate(registry, 'my project');
        assert.equal(result.valid, false);
        assert.equal(result.violations.filter((v) => v.severity === 'error').length, 1);
      });
    });

    describe('warnings for reserved namespaces', () => {
      it('warns on sys- prefix', () => {
        const result = validator.validate(registry, 'sys-project');
        assert.equal(result.valid, true);
        const warnings = result.violations.filter((v) => v.severity === 'warning');
        assert.ok(warnings.some((v) => v.rule === 'namespace-uniqueness'));
      });

      it('warns on internal- prefix', () => {
        const result = validator.validate(registry, 'internal-service');
        const warnings = result.violations.filter((v) => v.severity === 'warning');
        assert.ok(warnings.some((v) => v.rule === 'namespace-uniqueness'));
      });

      it('warns on reserved- prefix', () => {
        const result = validator.validate(registry, 'reserved-name');
        const warnings = result.violations.filter((v) => v.severity === 'warning');
        assert.ok(warnings.some((v) => v.rule === 'namespace-uniqueness'));
      });

      it('does not warn on non-reserved prefixes', () => {
        const result = validator.validate(registry, 'my-project');
        const warnings = result.violations.filter(
          (v) => v.severity === 'warning' && v.rule === 'namespace-uniqueness'
        );
        assert.equal(warnings.length, 0);
      });
    });

    describe('registry checks', () => {
      it('returns accessible registry state', () => {
        const result = validator.validate(registry, 'proj-1');

        const accessErrors = result.violations.filter((v) => v.rule === 'registry-accessible');
        assert.equal(accessErrors.length, 0);
      });

      it('validates against populated registry', () => {
        const result = validator.validate(registry, 'valid-project');

        const populatedWarnings = result.violations.filter(
          (v) => v.rule === 'registry-populated'
        );
        assert.ok([0, 1].includes(populatedWarnings.length));
      });
    });

    describe('ValidationResult structure', () => {
      it('returns valid boolean flag', () => {
        const result = validator.validate(registry, 'proj-1');
        assert.equal(typeof result.valid, 'boolean');
      });

      it('returns violations array', () => {
        const result = validator.validate(registry, 'proj-1');
        assert.ok(Array.isArray(result.violations));
      });

      it('all violations have required fields', () => {
        const result = validator.validate(registry, 'invalid!');
        result.violations.forEach((violation) => {
          assert.equal(typeof violation.rule, 'string');
          assert.ok(['error', 'warning'].includes(violation.severity));
          assert.equal(typeof violation.message, 'string');
        });
      });

      it('valid flag matches error count', () => {
        const validResult = validator.validate(registry, 'valid-proj');
        const errorCount = validResult.violations.filter((v) => v.severity === 'error').length;
        assert.equal(validResult.valid, errorCount === 0);

        const invalidResult = validator.validate(registry, '');
        const invalidErrorCount = invalidResult.violations.filter(
          (v) => v.severity === 'error'
        ).length;
        assert.equal(invalidResult.valid, invalidErrorCount === 0);
      });
    });
  });
});
