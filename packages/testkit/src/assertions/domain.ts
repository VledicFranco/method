/**
 * Domain theory assertions — validate signature, axioms, and axiom violations.
 */

import {
  type DomainTheory,
  validateSignature,
  validateAxioms,
} from "@method/methodts";

/**
 * Assert that a domain theory's signature is well-formed.
 * Fails with detailed signature error messages.
 */
export function assertSignatureValid<S>(domain: DomainTheory<S>): void {
  const result = validateSignature(domain);
  if (!result.valid) {
    throw new Error(
      `Signature invalid for domain "${domain.id}":\n` +
      result.errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
}

/**
 * Assert that all domain axioms are satisfied by at least one test state.
 * This is a satisfiability check — at least one state in the array must
 * pass all axioms.
 */
export function assertAxiomsSatisfied<S>(domain: DomainTheory<S>, testStates: S[]): void {
  if (testStates.length === 0) {
    throw new Error(
      `Cannot check axiom satisfaction for domain "${domain.id}": no test states provided`,
    );
  }

  const satisfied = testStates.some((s) => validateAxioms(domain, s).valid);
  if (!satisfied) {
    const details = testStates.map((s, i) => {
      const result = validateAxioms(domain, s);
      return `  State ${i}: violations = [${result.violations.join(", ")}]`;
    });
    throw new Error(
      `No test state satisfies all axioms for domain "${domain.id}":\n` +
      details.join("\n"),
    );
  }
}

/**
 * Assert that a specific state satisfies all domain axioms.
 * Fails with the list of violated axiom names.
 */
export function assertAxiomsHold<S>(domain: DomainTheory<S>, state: S): void {
  const result = validateAxioms(domain, state);
  if (!result.valid) {
    throw new Error(
      `Axiom violations for domain "${domain.id}": [${result.violations.join(", ")}]`,
    );
  }
}

/**
 * Assert that a specific state violates the expected axioms.
 * Useful for testing that axioms correctly reject invalid states.
 */
export function assertAxiomsViolated<S>(
  domain: DomainTheory<S>,
  state: S,
  expectedViolations: string[],
): void {
  const result = validateAxioms(domain, state);
  if (result.valid) {
    throw new Error(
      `Expected axiom violations [${expectedViolations.join(", ")}] for domain "${domain.id}", ` +
      `but all axioms passed`,
    );
  }

  const missing = expectedViolations.filter((v) => !result.violations.includes(v));
  if (missing.length > 0) {
    throw new Error(
      `Expected axiom violations [${expectedViolations.join(", ")}] for domain "${domain.id}", ` +
      `but only got [${result.violations.join(", ")}]. ` +
      `Missing: [${missing.join(", ")}]`,
    );
  }
}
