/**
 * Unit tests for Predicate constructors.
 *
 * Validates all 8 tagged variants of Predicate<A> — structural shape
 * and basic evaluation behavior through the constructor API.
 *
 * @see F1-FTH Definition 1.1 — closed Sigma-sentences
 */

import { describe, it, expect } from "vitest";
import {
  TRUE,
  FALSE,
  check,
  and,
  or,
  not,
  implies,
  forall,
  exists,
} from "../../predicate/predicate.js";
import { evaluate } from "../../predicate/evaluate.js";

// ── val ──

describe("TRUE / FALSE literals", () => {
  it("TRUE evaluates to true", () => {
    expect(evaluate(TRUE, undefined)).toBe(true);
  });

  it("FALSE evaluates to false", () => {
    expect(evaluate(FALSE, undefined)).toBe(false);
  });

  it("TRUE has tag 'val' and value true", () => {
    expect(TRUE).toEqual({ tag: "val", value: true });
  });

  it("FALSE has tag 'val' and value false", () => {
    expect(FALSE).toEqual({ tag: "val", value: false });
  });
});

// ── check ──

describe("check", () => {
  it("preserves label", () => {
    const p = check<number>("is-positive", (n) => n > 0);
    expect(p.tag).toBe("check");
    if (p.tag === "check") {
      expect(p.label).toBe("is-positive");
    }
  });

  it("calls function with the correct value", () => {
    const calls: number[] = [];
    const p = check<number>("spy", (n) => {
      calls.push(n);
      return n > 0;
    });
    evaluate(p, 42);
    expect(calls).toEqual([42]);
  });

  it("returns true when check passes", () => {
    const p = check<number>("gt-10", (n) => n > 10);
    expect(evaluate(p, 20)).toBe(true);
  });

  it("returns false when check fails", () => {
    const p = check<number>("gt-10", (n) => n > 10);
    expect(evaluate(p, 5)).toBe(false);
  });
});

// ── and ──

describe("and", () => {
  const t = check<number>("true", () => true);
  const f = check<number>("false", () => false);

  it("both true produces true", () => {
    expect(evaluate(and(t, t), 0)).toBe(true);
  });

  it("false left produces false (short-circuit)", () => {
    let rightCalled = false;
    const right = check<number>("right", () => {
      rightCalled = true;
      return true;
    });
    expect(evaluate(and(f, right), 0)).toBe(false);
    // JS && short-circuits — right should not be called
    expect(rightCalled).toBe(false);
  });

  it("true left, false right produces false", () => {
    expect(evaluate(and(t, f), 0)).toBe(false);
  });

  it("variadic: reduces multiple predicates left-to-right", () => {
    const p = and(t, t, t);
    expect(evaluate(p, 0)).toBe(true);
    // Structure: and(and(t, t), t)
    expect(p.tag).toBe("and");
  });
});

// ── or ──

describe("or", () => {
  const t = check<number>("true", () => true);
  const f = check<number>("false", () => false);

  it("both false produces false", () => {
    expect(evaluate(or(f, f), 0)).toBe(false);
  });

  it("true left produces true (short-circuit)", () => {
    let rightCalled = false;
    const right = check<number>("right", () => {
      rightCalled = true;
      return false;
    });
    expect(evaluate(or(t, right), 0)).toBe(true);
    // JS || short-circuits — right should not be called
    expect(rightCalled).toBe(false);
  });

  it("false left, true right produces true", () => {
    expect(evaluate(or(f, t), 0)).toBe(true);
  });

  it("variadic: reduces multiple predicates left-to-right", () => {
    const p = or(f, f, t);
    expect(evaluate(p, 0)).toBe(true);
  });
});

// ── not ──

describe("not", () => {
  it("inverts true to false", () => {
    expect(evaluate(not(TRUE), 0)).toBe(false);
  });

  it("inverts false to true", () => {
    expect(evaluate(not(FALSE), 0)).toBe(true);
  });

  it("produces tag 'not' with inner", () => {
    const p = not(TRUE);
    expect(p.tag).toBe("not");
    if (p.tag === "not") {
      expect(p.inner).toBe(TRUE);
    }
  });
});

// ── implies ──

describe("implies", () => {
  it("false antecedent implies anything is true", () => {
    expect(evaluate(implies(FALSE, FALSE), 0)).toBe(true);
    expect(evaluate(implies(FALSE, TRUE), 0)).toBe(true);
  });

  it("true antecedent, false consequent is false", () => {
    expect(evaluate(implies(TRUE, FALSE), 0)).toBe(false);
  });

  it("true antecedent, true consequent is true", () => {
    expect(evaluate(implies(TRUE, TRUE), 0)).toBe(true);
  });

  it("produces correct structure", () => {
    const p = implies(TRUE, FALSE);
    expect(p.tag).toBe("implies");
    if (p.tag === "implies") {
      expect(p.antecedent).toBe(TRUE);
      expect(p.consequent).toBe(FALSE);
    }
  });
});

// ── forall ──

describe("forall", () => {
  it("empty array is vacuously true", () => {
    const p = forall<number>("empty", () => [], TRUE);
    expect(evaluate(p, 0)).toBe(true);
  });

  it("all elements satisfy body produces true", () => {
    const p = forall<number>(
      "neighbors",
      (n) => [n - 1, n, n + 1],
      check("positive", (x) => x > -10),
    );
    expect(evaluate(p, 5)).toBe(true);
  });

  it("one element fails body produces false", () => {
    const p = forall<number>(
      "neighbors",
      (n) => [n - 1, n, n + 1],
      check("positive", (x) => x > 0),
    );
    // At n=0, elements are [-1, 0, 1]. -1 > 0 is false.
    expect(evaluate(p, 0)).toBe(false);
  });

  it("preserves label", () => {
    const p = forall<number>("my-label", () => [], TRUE);
    expect(p.tag).toBe("forall");
    if (p.tag === "forall") {
      expect(p.label).toBe("my-label");
    }
  });
});

// ── exists ──

describe("exists", () => {
  it("empty array produces false", () => {
    const p = exists<number>("empty", () => [], TRUE);
    expect(evaluate(p, 0)).toBe(false);
  });

  it("one element satisfies body produces true", () => {
    const p = exists<number>(
      "neighbors",
      (n) => [n - 1, n, n + 1],
      check("positive", (x) => x > 0),
    );
    // At n=0, elements are [-1, 0, 1]. 1 > 0 is true.
    expect(evaluate(p, 0)).toBe(true);
  });

  it("all elements fail body produces false", () => {
    const p = exists<number>(
      "neighbors",
      (n) => [n - 1, n, n + 1],
      check("huge", (x) => x > 100),
    );
    expect(evaluate(p, 0)).toBe(false);
  });

  it("preserves label", () => {
    const p = exists<number>("my-label", () => [], TRUE);
    expect(p.tag).toBe("exists");
    if (p.tag === "exists") {
      expect(p.label).toBe("my-label");
    }
  });
});
