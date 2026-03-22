/**
 * Property tests for Prompt<A> — verifying algebraic laws.
 *
 * Tests the monoid laws (identity + associativity) for andThen/empty,
 * and the contravariant functor laws (identity + composition) for contramap.
 *
 * Uses fast-check for property-based testing with arbitrary inputs.
 *
 * @see F1-FTH Definition 4.1 — guidance_sigma forms a monoid under sequential composition
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Prompt, empty, constant } from "../../prompt/prompt.js";

// ── Arbitrary generators ──

/**
 * Generate an arbitrary Prompt<string> that produces deterministic output
 * from the input context. We use constant prompts and context-dependent
 * prompts to cover both cases.
 */
const arbPrompt: fc.Arbitrary<Prompt<string>> = fc.oneof(
  fc.string().map((s) => constant<string>(s)),
  fc
    .func<[string], string>(fc.string())
    .map((f) => new Prompt<string>((a) => f(a))),
);

/**
 * Generate a pure function string -> string for contramap tests.
 */
const arbStringFn: fc.Arbitrary<(s: string) => string> =
  fc.func<[string], string>(fc.string());

// ── Monoid laws ──

describe("Monoid laws (andThen / empty)", () => {
  it("left identity: empty().andThen(p).run(x) === p.run(x)", () => {
    fc.assert(
      fc.property(arbPrompt, fc.string(), (p, x) => {
        expect(empty<string>().andThen(p).run(x)).toBe(p.run(x));
      }),
    );
  });

  it("right identity: p.andThen(empty()).run(x) === p.run(x)", () => {
    fc.assert(
      fc.property(arbPrompt, fc.string(), (p, x) => {
        expect(p.andThen(empty<string>()).run(x)).toBe(p.run(x));
      }),
    );
  });

  it("associativity: (a.andThen(b)).andThen(c).run(x) === a.andThen(b.andThen(c)).run(x)", () => {
    fc.assert(
      fc.property(arbPrompt, arbPrompt, arbPrompt, fc.string(), (a, b, c, x) => {
        const lhs = a.andThen(b).andThen(c).run(x);
        const rhs = a.andThen(b.andThen(c)).run(x);
        expect(lhs).toBe(rhs);
      }),
    );
  });
});

// ── Contravariant functor laws ──

describe("Contravariant functor laws (contramap)", () => {
  it("identity: p.contramap(x => x).run(a) === p.run(a)", () => {
    fc.assert(
      fc.property(arbPrompt, fc.string(), (p, a) => {
        expect(p.contramap<string>((x) => x).run(a)).toBe(p.run(a));
      }),
    );
  });

  it("composition: p.contramap(f).contramap(g).run(a) === p.contramap(x => f(g(x))).run(a)", () => {
    fc.assert(
      fc.property(
        arbPrompt,
        arbStringFn,
        arbStringFn,
        fc.string(),
        (p, f, g, a) => {
          const lhs = p.contramap(f).contramap(g).run(a);
          const rhs = p.contramap((x: string) => f(g(x))).run(a);
          expect(lhs).toBe(rhs);
        },
      ),
    );
  });
});

// ── Additional monoid properties ──

describe("Monoid additional properties", () => {
  it("empty is the unique identity element", () => {
    fc.assert(
      fc.property(fc.string(), (x) => {
        const e = empty<string>();
        expect(e.run(x)).toBe("");
      }),
    );
  });

  it("andThen with two non-empty prompts always contains separator", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string(),
        (s1, s2, x) => {
          const a = constant<string>(s1);
          const b = constant<string>(s2);
          const result = a.andThen(b).run(x);
          expect(result).toContain("\n\n");
          expect(result).toBe(`${s1}\n\n${s2}`);
        },
      ),
    );
  });

  it("sequence of n non-empty prompts has n-1 separators", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 10 }),
        (strings) => {
          const prompts = strings.map((s) => constant<string>(s));
          const result = prompts
            .reduce((acc, p) => acc.andThen(p), empty<string>())
            .run("");
          const separators = result.split("\n\n").length - 1;
          expect(separators).toBe(strings.length - 1);
        },
      ),
    );
  });
});

// ── Contravariant additional properties ──

describe("Contravariant additional properties", () => {
  it("contramap preserves empty: empty().contramap(f).run(a) === ''", () => {
    fc.assert(
      fc.property(arbStringFn, fc.string(), (f, a) => {
        expect(empty<string>().contramap(f).run(a)).toBe("");
      }),
    );
  });

  it("contramap distributes over andThen", () => {
    fc.assert(
      fc.property(
        arbPrompt,
        arbPrompt,
        arbStringFn,
        fc.string(),
        (p1, p2, f, a) => {
          const lhs = p1.andThen(p2).contramap(f).run(a);
          const rhs = p1.contramap(f).andThen(p2.contramap(f)).run(a);
          expect(lhs).toBe(rhs);
        },
      ),
    );
  });
});
