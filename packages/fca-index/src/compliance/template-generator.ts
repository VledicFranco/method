// SPDX-License-Identifier: Apache-2.0
/**
 * TemplateGenerator — Generates FCA stub content for missing parts.
 *
 * Each FcaPart maps to a suggested filename and template content.
 * The component name is derived from the last segment of the component path.
 * Templates are opinionated but minimal — the goal is a valid stub that
 * fca-index scan will detect as covering the required part.
 */

import type { FcaPart } from '../ports/context-query.js';
import type { PartSuggestion } from '../ports/compliance-suggestion.js';

export class TemplateGenerator {
  /**
   * Generate a stub suggestion for a specific FCA part.
   *
   * @param part — The FCA part to generate a stub for.
   * @param componentPath — The component path relative to projectRoot (used to derive the name).
   */
  generate(part: FcaPart, componentPath: string): PartSuggestion {
    const name = this.deriveName(componentPath);

    switch (part) {
      case 'interface':
        return {
          part,
          suggestedFile: 'index.ts',
          templateContent: this.interfaceTemplate(name, componentPath),
        };

      case 'documentation':
        return {
          part,
          suggestedFile: 'README.md',
          templateContent: this.documentationTemplate(name, componentPath),
        };

      case 'port':
        return {
          part,
          suggestedFile: 'ports.ts',
          templateContent: this.portTemplate(name),
        };

      case 'boundary':
        return {
          part,
          suggestedFile: 'boundary.ts',
          templateContent: this.boundaryTemplate(name),
        };

      case 'domain':
        return {
          part,
          suggestedFile: 'domain.ts',
          templateContent: this.domainTemplate(name, componentPath),
        };

      case 'architecture':
        return {
          part,
          suggestedFile: 'ARCHITECTURE.md',
          templateContent: this.architectureTemplate(name, componentPath),
        };

      case 'verification':
        return {
          part,
          suggestedFile: `${name}.test.ts`,
          templateContent: this.verificationTemplate(name),
        };

      case 'observability':
        return {
          part,
          suggestedFile: 'observability.ts',
          templateContent: this.observabilityTemplate(name),
        };
    }
  }

  private deriveName(componentPath: string): string {
    // Take the last non-empty segment of the path as the component name.
    const segments = componentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? 'component';
    // Convert kebab-case or snake_case to PascalCase for use in identifiers.
    return last
      .split(/[-_]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  private interfaceTemplate(name: string, componentPath: string): string {
    return `/**
 * ${name} — public interface for the ${componentPath} component.
 *
 * @interface
 *
 * This file is the FCA 'interface' part for this component.
 * Export all public types, interfaces, and functions that external consumers use.
 * Internal implementation details should NOT be exported from here.
 */

export {};
`;
  }

  private documentationTemplate(name: string, componentPath: string): string {
    return `# ${name}

## Purpose

TODO: Describe the purpose of this component. What problem does it solve?
What is its responsibility in the system?

## Ports

TODO: List the port interfaces this component exposes or consumes.
What are the dependencies injected into it? What does it produce?

## Usage

\`\`\`typescript
// TODO: Add a usage example
\`\`\`

## FCA Component Info

- **Path:** \`${componentPath}\`
- **Layer:** TODO (L0–L5)
- **Owner:** TODO
`;
  }

  private portTemplate(name: string): string {
    return `/**
 * ${name}Ports — Port interfaces consumed by this component.
 *
 * This file is the FCA 'port' part for this component.
 * Define interfaces for external dependencies accessed through dependency injection.
 */

/**
 * TODO: Define the port interface for this component's primary dependency.
 * Replace this stub with a real typed interface.
 */
export interface ${name}Port {
  // TODO: Add typed methods
}
`;
  }

  private boundaryTemplate(name: string): string {
    return `/**
 * ${name}Boundary — Boundary exports for this component.
 *
 * This file is the FCA 'boundary' part for this component.
 * Re-export only the public surface — types and functions that cross the component boundary.
 * Internal implementation files should NOT be exported from here.
 */

// TODO: Add explicit boundary exports
// Example:
// export type { ${name}Config } from './config.js';
// export { create${name} } from './factory.js';

export {};
`;
  }

  private domainTemplate(name: string, componentPath: string): string {
    return `/**
 * ${name}Domain — Domain concept description for ${componentPath}.
 *
 * This file is the FCA 'domain' part for this component.
 * Document the domain concept, its invariants, and its role in the system.
 *
 * Domain concept:
 *   TODO: Describe the core domain concept this component represents.
 *   What are the business rules? What invariants must hold?
 *   What lifecycle does the domain entity have?
 *
 * Invariants:
 *   - TODO
 *
 * Ubiquitous language:
 *   - TODO: Define key terms used in this domain
 */

export {};
`;
  }

  private architectureTemplate(name: string, componentPath: string): string {
    return `# ${name} — Architecture

## Overview

TODO: Describe the architectural structure of this component.
How is it organized internally? What are the main concerns and how are they separated?

## Layer Placement

- **FCA Level:** TODO (L0 function / L1 module / L2 service / L3 library / L4 application / L5 system)
- **Path:** \`${componentPath}\`

## Internal Structure

\`\`\`
${componentPath}/
  index.ts          — public interface (FCA: interface)
  README.md         — documentation (FCA: documentation)
  ports.ts          — port interfaces (FCA: port)
  boundary.ts       — boundary exports (FCA: boundary)
  domain.ts         — domain description (FCA: domain)
  ARCHITECTURE.md   — this file (FCA: architecture)
  *.test.ts         — verification (FCA: verification)
  observability.ts  — logging/metrics (FCA: observability)
\`\`\`

## Dependencies

TODO: List dependencies (consumed ports) and consumers (who depends on this).

## Key Decisions

TODO: Record significant architectural decisions and their rationale.
`;
  }

  private verificationTemplate(name: string): string {
    return `/**
 * ${name} — verification tests.
 *
 * This file is the FCA 'verification' part for this component.
 * Add unit and integration tests that verify the component's contract.
 */

import { describe, it, expect } from 'vitest';

describe('${name}', () => {
  it('should be tested', () => {
    // TODO: Replace this stub with real tests.
    // Test the public interface, not internal implementation.
    expect(true).toBe(true);
  });
});
`;
  }

  private observabilityTemplate(name: string): string {
    return `/**
 * ${name}Observability — Structured logging for this component.
 *
 * This file is the FCA 'observability' part for this component.
 * Use these helpers to emit structured, consistently-formatted log entries.
 * Pair with a logger port for testability.
 */

/**
 * Structured log event types for ${name}.
 * Each event has a fixed shape — no ad-hoc string interpolation.
 */
export type ${name}LogEvent =
  | { event: '${camelCase(name)}.started'; context: string }
  | { event: '${camelCase(name)}.completed'; durationMs: number }
  | { event: '${camelCase(name)}.failed'; error: string };

/**
 * Emit a structured log event.
 * Replace the console.warn with a real logger port in production.
 */
export function log${name}Event(entry: ${name}LogEvent): void {
  // TODO: Replace with injected logger port
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ ...entry, component: '${name}' }));
}
`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function camelCase(pascalCase: string): string {
  if (pascalCase.length === 0) return pascalCase;
  return pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1);
}
