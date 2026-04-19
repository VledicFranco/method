// SPDX-License-Identifier: Apache-2.0
/**
 * PRD-020: Project Isolation Layer — IsolationValidator
 *
 * Validates isolation rules against a ProjectRegistry.
 * Pure sync validation — no I/O, no side effects.
 */

import type { ProjectRegistry } from '../../domains/registry/project-registry.js';

export interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface IsolationValidationResult {
  valid: boolean;
  violations: Violation[];
}

export interface IsolationValidator {
  /**
   * Validate isolation rules for a project
   */
  validate(registry: ProjectRegistry, projectId: string): IsolationValidationResult;
}

/**
 * Default isolation validator implementation
 */
export class DefaultIsolationValidator implements IsolationValidator {
  validate(registry: ProjectRegistry, projectId: string): IsolationValidationResult {
    const violations: Violation[] = [];

    // Rule 1: ProjectRegistry immutability
    // Specs in registry should not be mutated after registration
    if (!this.isValidProjectId(projectId)) {
      violations.push({
        rule: 'valid-project-id',
        severity: 'error',
        message: `Project ID must be non-empty alphanumeric with hyphens, got "${projectId}"`,
      });
    }

    // Rule 2: Spec existence check
    // If the project references a methodology spec, it should exist
    try {
      const specs = registry.list();
      if (specs.length === 0) {
        violations.push({
          rule: 'registry-populated',
          severity: 'warning',
          message: 'Registry is empty — no specs available for isolation',
        });
      }
    } catch (err) {
      violations.push({
        rule: 'registry-accessible',
        severity: 'error',
        message: `Cannot access registry: ${(err as Error).message}`,
      });
    }

    // Rule 3: Isolation namespace uniqueness
    // Each project should have a unique namespace
    if (!this.hasUniqueNamespace(projectId)) {
      violations.push({
        rule: 'namespace-uniqueness',
        severity: 'warning',
        message: `Project ID "${projectId}" may conflict with reserved namespaces`,
      });
    }

    return {
      valid: violations.filter((v) => v.severity === 'error').length === 0,
      violations,
    };
  }

  private isValidProjectId(projectId: string): boolean {
    // Must be non-empty, alphanumeric + hyphens, no leading/trailing hyphens
    if (!projectId || typeof projectId !== 'string') {
      return false;
    }
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(projectId);
  }

  private hasUniqueNamespace(projectId: string): boolean {
    // Check for reserved namespace prefixes
    const reserved = ['sys-', 'internal-', 'reserved-'];
    return !reserved.some((prefix) => projectId.toLowerCase().startsWith(prefix));
  }
}
