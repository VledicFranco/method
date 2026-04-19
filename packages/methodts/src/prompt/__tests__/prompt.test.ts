// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for Prompt<A> — the composable prompt algebra.
 *
 * Tests the Prompt class and all constructors defined in prompt.ts.
 * Prompt maps to F1-FTH Definition 4.1 (guidance_sigma : Context -> Text).
 *
 * @example
 * // Run with: cd packages/methodts && npx vitest run src/prompt/__tests__/prompt.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  Prompt,
  constant,
  empty,
  sequence,
  cond,
  match,
  template,
} from "../../prompt/prompt.js";

// ── Test context types ──

interface ProjectCtx {
  name: string;
  filesChanged: number;
  phase: "plan" | "implement" | "review";
}

const sampleCtx: ProjectCtx = {
  name: "method",
  filesChanged: 5,
  phase: "implement",
};

// ── Prompt constructor ──

describe("Prompt constructor", () => {
  it("creates a prompt from a function and runs it", () => {
    const p = new Prompt<number>((n) => `Count: ${n}`);
    expect(p.run(42)).toBe("Count: 42");
  });

  it("can use complex context objects", () => {
    const p = new Prompt<ProjectCtx>(
      (ctx) => `Project ${ctx.name} has ${ctx.filesChanged} files changed`,
    );
    expect(p.run(sampleCtx)).toBe("Project method has 5 files changed");
  });

  it("run is a pure function — same input produces same output", () => {
    const p = new Prompt<string>((s) => s.toUpperCase());
    expect(p.run("hello")).toBe("HELLO");
    expect(p.run("hello")).toBe("HELLO");
  });
});

// ── andThen ──

describe("andThen", () => {
  it("combines two prompts with double-newline separator", () => {
    const a = constant<number>("First");
    const b = constant<number>("Second");
    expect(a.andThen(b).run(0)).toBe("First\n\nSecond");
  });

  it("skips left when left is empty", () => {
    const a = empty<number>();
    const b = constant<number>("Only right");
    expect(a.andThen(b).run(0)).toBe("Only right");
  });

  it("skips right when right is empty", () => {
    const a = constant<number>("Only left");
    const b = empty<number>();
    expect(a.andThen(b).run(0)).toBe("Only left");
  });

  it("returns empty when both are empty", () => {
    const a = empty<number>();
    const b = empty<number>();
    expect(a.andThen(b).run(0)).toBe("");
  });

  it("chains three prompts correctly", () => {
    const a = constant<number>("A");
    const b = constant<number>("B");
    const c = constant<number>("C");
    expect(a.andThen(b).andThen(c).run(0)).toBe("A\n\nB\n\nC");
  });
});

// ── contramap ──

describe("contramap", () => {
  it("adapts context type via function", () => {
    const numPrompt = new Prompt<number>((n) => `Value: ${n}`);
    const strPrompt = numPrompt.contramap<string>((s) => s.length);
    expect(strPrompt.run("hello")).toBe("Value: 5");
  });

  it("satisfies p.contramap(f).run(b) === p.run(f(b))", () => {
    const p = new Prompt<number>((n) => `N=${n}`);
    const f = (s: string) => s.length;
    const b = "testing";
    expect(p.contramap(f).run(b)).toBe(p.run(f(b)));
  });

  it("composes multiple contramaps", () => {
    const p = new Prompt<number>((n) => String(n));
    const result = p
      .contramap<string>((s) => s.length)
      .contramap<string[]>((arr) => arr.join(","));
    expect(result.run(["a", "b", "c"])).toBe("5"); // "a,b,c".length = 5
  });

  it("works with complex context extraction", () => {
    const namePrompt = new Prompt<string>((name) => `Project: ${name}`);
    const ctxPrompt = namePrompt.contramap<ProjectCtx>((ctx) => ctx.name);
    expect(ctxPrompt.run(sampleCtx)).toBe("Project: method");
  });
});

// ── map ──

describe("map", () => {
  it("transforms the output string", () => {
    const p = constant<number>("hello");
    const mapped = p.map((s) => s.toUpperCase());
    expect(mapped.run(0)).toBe("HELLO");
  });

  it("can wrap output in markdown", () => {
    const p = constant<number>("content");
    const wrapped = p.map((s) => `**${s}**`);
    expect(wrapped.run(0)).toBe("**content**");
  });

  it("composes with andThen", () => {
    const a = constant<number>("hello").map((s) => s.toUpperCase());
    const b = constant<number>("world");
    expect(a.andThen(b).run(0)).toBe("HELLO\n\nworld");
  });
});

// ── when ──

describe("when", () => {
  it("emits output when predicate is true", () => {
    const p = constant<number>("Warning!").when((n) => n > 10);
    expect(p.run(15)).toBe("Warning!");
  });

  it("returns empty string when predicate is false", () => {
    const p = constant<number>("Warning!").when((n) => n > 10);
    expect(p.run(3)).toBe("");
  });

  it("works with complex predicates", () => {
    const p = new Prompt<ProjectCtx>(
      (ctx) => `Review ${ctx.name}`,
    ).when((ctx) => ctx.phase === "review");
    expect(p.run(sampleCtx)).toBe(""); // phase is "implement"
    expect(p.run({ ...sampleCtx, phase: "review" })).toBe("Review method");
  });
});

// ── section ──

describe("section", () => {
  it("wraps non-empty body in a markdown section", () => {
    const p = constant<number>("Some content").section("Overview");
    expect(p.run(0)).toBe("## Overview\n\nSome content");
  });

  it("returns empty string for empty body", () => {
    const p = empty<number>().section("Overview");
    expect(p.run(0)).toBe("");
  });

  it("preserves multi-line body", () => {
    const p = constant<number>("Line 1\nLine 2").section("Details");
    expect(p.run(0)).toBe("## Details\n\nLine 1\nLine 2");
  });
});

// ── indent ──

describe("indent", () => {
  it("indents every line by default 2 spaces", () => {
    const p = constant<number>("line 1\nline 2").indent();
    expect(p.run(0)).toBe("  line 1\n  line 2");
  });

  it("indents by a custom number of spaces", () => {
    const p = constant<number>("a\nb").indent(4);
    expect(p.run(0)).toBe("    a\n    b");
  });

  it("handles single-line strings", () => {
    const p = constant<number>("single").indent(3);
    expect(p.run(0)).toBe("   single");
  });

  it("indents empty lines too", () => {
    const p = constant<number>("a\n\nb").indent(2);
    expect(p.run(0)).toBe("  a\n  \n  b");
  });
});

// ── constant ──

describe("constant", () => {
  it("returns the same string regardless of context", () => {
    const p = constant<number>("fixed");
    expect(p.run(0)).toBe("fixed");
    expect(p.run(999)).toBe("fixed");
    expect(p.run(-1)).toBe("fixed");
  });

  it("works with empty string", () => {
    const p = constant<number>("");
    expect(p.run(0)).toBe("");
  });

  it("preserves whitespace and special characters", () => {
    const p = constant<number>("  \ttabs\nand\nnewlines  ");
    expect(p.run(0)).toBe("  \ttabs\nand\nnewlines  ");
  });
});

// ── empty ──

describe("empty", () => {
  it("always returns empty string", () => {
    const p = empty<number>();
    expect(p.run(0)).toBe("");
    expect(p.run(42)).toBe("");
  });

  it("works with any context type", () => {
    const p = empty<ProjectCtx>();
    expect(p.run(sampleCtx)).toBe("");
  });
});

// ── sequence ──

describe("sequence", () => {
  it("folds an array of prompts with andThen", () => {
    const result = sequence(
      constant<number>("A"),
      constant<number>("B"),
      constant<number>("C"),
    );
    expect(result.run(0)).toBe("A\n\nB\n\nC");
  });

  it("skips empty prompts in the sequence", () => {
    const result = sequence(
      constant<number>("A"),
      empty<number>(),
      constant<number>("C"),
    );
    expect(result.run(0)).toBe("A\n\nC");
  });

  it("returns empty for empty sequence", () => {
    const result = sequence<number>();
    expect(result.run(0)).toBe("");
  });

  it("returns single prompt unchanged", () => {
    const result = sequence(constant<number>("Only"));
    expect(result.run(0)).toBe("Only");
  });

  it("handles all-empty sequence", () => {
    const result = sequence(empty<number>(), empty<number>());
    expect(result.run(0)).toBe("");
  });
});

// ── cond ──

describe("cond", () => {
  it("emits then-branch when predicate is true", () => {
    const p = cond<number>(
      (n) => n > 5,
      constant("Large"),
      constant("Small"),
    );
    expect(p.run(10)).toBe("Large");
  });

  it("emits otherwise-branch when predicate is false", () => {
    const p = cond<number>(
      (n) => n > 5,
      constant("Large"),
      constant("Small"),
    );
    expect(p.run(2)).toBe("Small");
  });

  it("defaults otherwise to empty when not provided", () => {
    const p = cond<number>((n) => n > 5, constant("Large"));
    expect(p.run(2)).toBe("");
  });

  it("works with context-dependent prompts", () => {
    const p = cond<ProjectCtx>(
      (ctx) => ctx.filesChanged > 10,
      new Prompt((ctx) => `${ctx.name}: large changeset`),
      new Prompt((ctx) => `${ctx.name}: small changeset`),
    );
    expect(p.run(sampleCtx)).toBe("method: small changeset");
    expect(p.run({ ...sampleCtx, filesChanged: 20 })).toBe(
      "method: large changeset",
    );
  });
});

// ── match ──

describe("match", () => {
  it("selects the first matching branch", () => {
    const p = match<ProjectCtx>([
      { when: (ctx) => ctx.phase === "plan", then: constant("Planning") },
      {
        when: (ctx) => ctx.phase === "implement",
        then: constant("Implementing"),
      },
      { when: (ctx) => ctx.phase === "review", then: constant("Reviewing") },
    ]);
    expect(p.run(sampleCtx)).toBe("Implementing");
  });

  it("uses fallback when no branch matches", () => {
    const p = match<number>(
      [{ when: (n) => n > 100, then: constant("Big") }],
      constant("Default"),
    );
    expect(p.run(5)).toBe("Default");
  });

  it("defaults fallback to empty", () => {
    const p = match<number>([
      { when: (n) => n > 100, then: constant("Big") },
    ]);
    expect(p.run(5)).toBe("");
  });

  it("picks first match when multiple branches match", () => {
    const p = match<number>([
      { when: (n) => n > 0, then: constant("Positive") },
      { when: (n) => n > 5, then: constant("Big positive") },
    ]);
    expect(p.run(10)).toBe("Positive");
  });

  it("handles empty branches array", () => {
    const p = match<number>([], constant("Fallback"));
    expect(p.run(0)).toBe("Fallback");
  });
});

// ── template ──

describe("template", () => {
  it("interpolates context values via tagged template", () => {
    const p = template<ProjectCtx>`Project: ${(ctx) => ctx.name}`;
    expect(p.run(sampleCtx)).toBe("Project: method");
  });

  it("handles multiple interpolations", () => {
    const p = template<ProjectCtx>`${(ctx) => ctx.name} (${(ctx) => ctx.phase}): ${(ctx) => String(ctx.filesChanged)} files`;
    expect(p.run(sampleCtx)).toBe("method (implement): 5 files");
  });

  it("handles no interpolations (plain string)", () => {
    const p = template<number>`Just a plain string`;
    expect(p.run(42)).toBe("Just a plain string");
  });

  it("handles empty template", () => {
    const p = template<number>``;
    expect(p.run(0)).toBe("");
  });

  it("handles interpolation at boundaries", () => {
    const p = template<string>`${(s) => s}!`;
    expect(p.run("hello")).toBe("hello!");
  });
});

// ── Integration: combining operations ──

describe("integration: composing operations", () => {
  it("builds a realistic prompt from parts", () => {
    const header = constant<ProjectCtx>("You are an implementation agent.");
    const scope = new Prompt<ProjectCtx>(
      (ctx) => `Working on project: ${ctx.name}`,
    ).section("Scope");
    const warning = constant<ProjectCtx>(
      "This is a large change — review carefully.",
    ).when((ctx) => ctx.filesChanged > 10);

    const full = sequence(header, scope, warning);

    // Without warning (filesChanged = 5, below threshold)
    expect(full.run(sampleCtx)).toBe(
      "You are an implementation agent.\n\n## Scope\n\nWorking on project: method",
    );

    // With warning (filesChanged = 20, above threshold)
    const largeCtx = { ...sampleCtx, filesChanged: 20 };
    expect(full.run(largeCtx)).toBe(
      "You are an implementation agent.\n\n## Scope\n\nWorking on project: method\n\nThis is a large change — review carefully.",
    );
  });

  it("uses contramap to specialize a general prompt", () => {
    interface Session {
      project: ProjectCtx;
      sessionId: string;
    }
    const projectPrompt = new Prompt<ProjectCtx>(
      (ctx) => `Project: ${ctx.name}`,
    );
    const sessionPrompt = projectPrompt.contramap<Session>((s) => s.project);
    expect(
      sessionPrompt.run({ project: sampleCtx, sessionId: "s-001" }),
    ).toBe("Project: method");
  });

  it("indents a section", () => {
    const p = constant<number>("Step 1\nStep 2")
      .section("Instructions")
      .indent(4);
    expect(p.run(0)).toBe(
      "    ## Instructions\n    \n    Step 1\n    Step 2",
    );
  });
});
