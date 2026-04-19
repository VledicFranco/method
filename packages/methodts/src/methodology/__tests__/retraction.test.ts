// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for verifyRetraction and TerminationCertificate construction.
 *
 * F1-FTH Definition 6.3: Retraction<P, C> with project . embed = id
 * F1-FTH Definition 7.4: TerminationCertificate<S>
 */

import { describe, it, expect } from "vitest";
import { verifyRetraction, type Retraction } from "../retraction.js";
import type { TerminationCertificate } from "../methodology.js";

type Parent = { x: number; y: number; label: string };
type Child = { x: number; y: number };

describe("verifyRetraction", () => {
  it("returns valid for a correct round-trip retraction", () => {
    const retraction: Retraction<Parent, Child> = {
      id: "project-xy",
      embed: (p) => ({ x: p.x, y: p.y }),
      project: (c) => ({ x: c.x, y: c.y, label: "" }),
    };

    // For this retraction, the "touched subspace" is {x, y}. Label is not in scope.
    // We need a custom compare that only checks the touched dimensions.
    const result = verifyRetraction(
      retraction,
      [
        { x: 1, y: 2, label: "" },
        { x: 0, y: 0, label: "" },
        { x: -5, y: 100, label: "" },
      ],
      (a, b) => a.x === b.x && a.y === b.y,
    );

    expect(result.valid).toBe(true);
    expect(result.counterexample).toBeNull();
  });

  it("returns invalid with counterexample for a broken round-trip", () => {
    const badRetraction: Retraction<Parent, Child> = {
      id: "broken",
      embed: (p) => ({ x: p.x, y: p.y }),
      project: (c) => ({ x: c.x + 1, y: c.y, label: "" }), // corrupts x
    };

    const result = verifyRetraction(
      badRetraction,
      [{ x: 5, y: 10, label: "test" }],
    );

    expect(result.valid).toBe(false);
    expect(result.counterexample).toEqual({ x: 5, y: 10, label: "test" });
  });

  it("uses custom compare function when provided", () => {
    // Retraction that preserves x but not y — custom compare only checks x
    const retraction: Retraction<Parent, Child> = {
      id: "x-only",
      embed: (p) => ({ x: p.x, y: 999 }),
      project: (c) => ({ x: c.x, y: 0, label: "" }),
    };

    const validByX = verifyRetraction(
      retraction,
      [{ x: 42, y: 7, label: "test" }],
      (a, b) => a.x === b.x,
    );
    expect(validByX.valid).toBe(true);

    // Without custom compare, default JSON.stringify fails because y differs
    const invalidByDefault = verifyRetraction(
      retraction,
      [{ x: 42, y: 7, label: "test" }],
    );
    expect(invalidByDefault.valid).toBe(false);
  });
});

describe("TerminationCertificate", () => {
  it("constructs a well-founded measure with strict decrease argument", () => {
    type RunState = { stepsRemaining: number };

    const cert: TerminationCertificate<RunState> = {
      measure: (s) => s.stepsRemaining,
      decreases: "Each method execution reduces stepsRemaining by at least 1.",
    };

    expect(cert.measure({ stepsRemaining: 5 })).toBe(5);
    expect(cert.measure({ stepsRemaining: 0 })).toBe(0);
    expect(cert.decreases).toContain("stepsRemaining");
  });
});
