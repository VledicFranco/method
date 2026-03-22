/**
 * renderDomainFacts — Render domain theory elements as formatted text.
 *
 * Produces a markdown-formatted string containing axioms, predicates,
 * sorts, and role constraints selected by the DomainFactsSpec filter.
 * This is Channel 3 of the Step Context Protocol.
 *
 * @see PRD 021 §12.3 — Step Context Protocol, Channel 3
 */

import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { DomainFactsSpec } from "../method/step.js";

/**
 * Render domain theory elements as a formatted string for agent context.
 *
 * Produces sections for axioms, predicates, sorts, and role constraints
 * based on the DomainFactsSpec filter. Returns empty string if no sections
 * are applicable.
 */
export function renderDomainFacts<S>(
  spec: DomainFactsSpec,
  domain: DomainTheory<S>,
  role?: Role<S, any>,
): string {
  const sections: string[] = [];

  // Axioms
  if (spec.axioms) {
    const axiomNames =
      spec.axioms === "all"
        ? Object.keys(domain.axioms)
        : (spec.axioms as readonly string[]);
    if (axiomNames.length > 0) {
      sections.push(
        "## Domain Axioms\n" +
          axiomNames.map((name) => `- Invariant: ${name}`).join("\n"),
      );
    }
  }

  // Predicates
  if (spec.predicates) {
    const predNames =
      spec.predicates === "all"
        ? Object.keys(domain.signature.predicates)
        : (spec.predicates as readonly string[]);
    if (predNames.length > 0) {
      sections.push(
        "## Domain Predicates\n" +
          predNames.map((name) => `- Predicate: ${name}`).join("\n"),
      );
    }
  }

  // Sorts
  if (spec.sorts) {
    const sortFilter =
      spec.sorts === "all"
        ? domain.signature.sorts.map((s) => s.name)
        : (spec.sorts as readonly string[]);
    const sorts = domain.signature.sorts.filter((s) =>
      sortFilter.includes(s.name),
    );
    if (sorts.length > 0) {
      sections.push(
        "## Domain Sorts\n" +
          sorts
            .map((s) => `- ${s.name}: ${s.description} (${s.cardinality})`)
            .join("\n"),
      );
    }
  }

  // Role constraints
  if (spec.roleConstraints && role) {
    const constraints: string[] = [];
    if (role.authorized.length > 0)
      constraints.push(`Authorized: ${role.authorized.join(", ")}`);
    if (role.notAuthorized.length > 0)
      constraints.push(`Not authorized: ${role.notAuthorized.join(", ")}`);
    if (constraints.length > 0) {
      sections.push(
        `## Role: ${role.id}\n${role.description}\n` +
          constraints.join("\n"),
      );
    }
  }

  return sections.join("\n\n");
}
