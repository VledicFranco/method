// SPDX-License-Identifier: Apache-2.0
/**
 * Step<S> type construction tests.
 *
 * Validates that the Step, StepExecution, and SuspensionPolicy types
 * can be constructed correctly for all variants.
 *
 * F1-FTH Definition 4.1: sigma = (pre, post, guidance, tools)
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { Step, StepExecution, SuspensionPolicy } from "../step.js";
import { TRUE, FALSE, check } from "../../predicate/predicate.js";
import { Prompt } from "../../prompt/prompt.js";

type TestState = { readonly phase: string; readonly count: number };

describe("Step — type construction (F1-FTH Def 4.1)", () => {
  it("constructs an agent variant with all fields", () => {
    const step: Step<TestState> = {
      id: "s-review",
      name: "Code Review",
      role: "reviewer",
      precondition: check<TestState>("has-code", (s) => s.phase === "coded"),
      postcondition: check<TestState>("reviewed", (s) => s.phase === "reviewed"),
      execution: {
        tag: "agent",
        role: "reviewer",
        context: {
          insightDeps: ["architecture"],
          produceInsight: { key: "review-result", instruction: "Summarize findings" },
          domainFacts: { axioms: "all", predicates: ["has-code"] },
          sufficient: check("ctx-sufficient", (ctx) => ctx.state.count > 0),
        },
        prompt: new Prompt<{ readonly state: TestState; readonly world: Readonly<Record<string, string>>; readonly insights: Readonly<Record<string, string>>; readonly domainFacts: string }>((ctx) => `Review code in phase ${ctx.state.phase}`),
        parse: (raw, current) => Effect.succeed({ ...current, phase: "reviewed" }),
        parseInsight: (raw) => raw.trim(),
      },
      tools: ["read_file", "grep"],
      suspension: "on_failure",
    };

    expect(step.id).toBe("s-review");
    expect(step.name).toBe("Code Review");
    expect(step.role).toBe("reviewer");
    expect(step.execution.tag).toBe("agent");
    expect(step.tools).toEqual(["read_file", "grep"]);
    expect(step.suspension).toBe("on_failure");
  });

  it("constructs a script variant", () => {
    const step: Step<TestState> = {
      id: "s-bump",
      name: "Bump Counter",
      role: "automation",
      precondition: TRUE,
      postcondition: check<TestState>("count-bumped", (s) => s.count > 0),
      execution: {
        tag: "script",
        execute: (s) => Effect.succeed({ ...s, count: s.count + 1 }),
      },
    };

    expect(step.id).toBe("s-bump");
    expect(step.execution.tag).toBe("script");
    expect(step.tools).toBeUndefined();
    expect(step.suspension).toBeUndefined();
  });

  it("constructs a step with minimal fields (no optional tools/suspension)", () => {
    const step: Step<TestState> = {
      id: "s-init",
      name: "Initialize",
      role: "system",
      precondition: TRUE,
      postcondition: TRUE,
      execution: { tag: "script", execute: (s) => Effect.succeed(s) },
    };

    expect(step.id).toBe("s-init");
    expect(step.tools).toBeUndefined();
    expect(step.suspension).toBeUndefined();
  });
});

describe("SuspensionPolicy — variant construction", () => {
  it("supports 'never' literal", () => {
    const policy: SuspensionPolicy<TestState> = "never";
    expect(policy).toBe("never");
  });

  it("supports 'on_failure' literal", () => {
    const policy: SuspensionPolicy<TestState> = "on_failure";
    expect(policy).toBe("on_failure");
  });

  it("supports 'always' literal", () => {
    const policy: SuspensionPolicy<TestState> = "always";
    expect(policy).toBe("always");
  });

  it("supports on_condition variant with predicate", () => {
    const policy: SuspensionPolicy<TestState> = {
      tag: "on_condition",
      condition: check<TestState>("needs-pause", (s) => s.count > 10),
    };

    expect(policy).toEqual(
      expect.objectContaining({ tag: "on_condition" }),
    );
    // Verify the condition predicate is present and callable
    expect(typeof (policy as { tag: "on_condition"; condition: any }).condition.check).toBe("function");
  });
});
