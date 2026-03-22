/**
 * Tests for P0_META methodology, transition arms, and prompt templates.
 *
 * Validates:
 * - P0_META structural properties (id, name, arm count, priorities)
 * - Transition routing via evaluateTransition for each arm
 * - Priority ordering (higher priority arms win)
 * - Prompt template rendering
 */

import { describe, it, expect } from "vitest";
import { P0_META } from "../meta/p0-meta.js";
import {
  arm_gap_severity,
  arm_lifecycle_design,
  arm_lifecycle_instantiation,
  arm_structural_composition,
  arm_structural_audit,
  arm_implementation_derivation,
  arm_discovery,
  arm_terminate,
} from "../meta/arms.js";
import { evaluateTransition } from "../../methodology/transition.js";
import { prompts } from "../prompts.js";
import type { MetaState } from "../types.js";

// ── Test states ──

const stateWithHighGap: MetaState = {
  targetRegistry: ["M1"],
  compiledMethods: ["M1"],
  highGapMethods: ["M1"],
  needsInstantiation: [],
  composablePairs: [],
  informalPractices: [],
  selfConsistentMethods: ["M1"],
};

const stateWithInformal: MetaState = {
  targetRegistry: ["M1"],
  compiledMethods: ["M1"],
  highGapMethods: [],
  needsInstantiation: [],
  composablePairs: [],
  informalPractices: ["code-review"],
  selfConsistentMethods: ["M1"],
};

const stateNeedsInstantiation: MetaState = {
  targetRegistry: ["M1"],
  compiledMethods: ["M1"],
  highGapMethods: [],
  needsInstantiation: ["M1"],
  composablePairs: [],
  informalPractices: [],
  selfConsistentMethods: ["M1"],
};

const stateWithComposable: MetaState = {
  targetRegistry: ["M1", "M2"],
  compiledMethods: ["M1", "M2"],
  highGapMethods: [],
  needsInstantiation: [],
  composablePairs: [["M1", "M2"]],
  informalPractices: [],
  selfConsistentMethods: ["M1", "M2"],
};

const stateNotSelfConsistent: MetaState = {
  targetRegistry: ["M1"],
  compiledMethods: ["M1"],
  highGapMethods: [],
  needsInstantiation: [],
  composablePairs: [],
  informalPractices: [],
  selfConsistentMethods: [], // M1 is compiled but not self-consistent
};

const stateWithUncompiled: MetaState = {
  targetRegistry: ["M1", "M2"],
  compiledMethods: [], // No compiled methods yet, so arm 6 (compiled_exists) doesn't fire
  highGapMethods: [],
  needsInstantiation: [],
  composablePairs: [],
  informalPractices: [],
  selfConsistentMethods: [],
};

// Note: arm 6 (implementation_derivation) fires whenever compiledMethods is non-empty,
// which blocks arms 7 and 8. For terminate to fire, compiledMethods must be empty —
// but the terminate condition requires targetRegistry.every(m => compiledMethods.includes(m)),
// which only holds when targetRegistry is also empty. This represents "no work defined, no work pending."
const stateAllClean: MetaState = {
  targetRegistry: [],
  compiledMethods: [],
  highGapMethods: [],
  needsInstantiation: [],
  composablePairs: [],
  informalPractices: [],
  selfConsistentMethods: [],
};

// ── P0_META structural tests ──

describe("P0_META", () => {
  it("has correct id", () => {
    expect(P0_META.id).toBe("P0-META");
  });

  it("has correct name", () => {
    expect(P0_META.name).toBe("Genesis Methodology for the Meta-Method Family");
  });

  it("has 8 arms", () => {
    expect(P0_META.arms).toHaveLength(8);
  });

  it("has arms with priorities 1-8", () => {
    const priorities = P0_META.arms.map((a) => a.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("has correct arm labels in priority order", () => {
    const labels = P0_META.arms.map((a) => a.label);
    expect(labels).toEqual([
      "gap_severity_first",
      "lifecycle_design",
      "lifecycle_instantiation",
      "structural_composition",
      "structural_audit",
      "implementation_derivation",
      "discovery",
      "terminate",
    ]);
  });

  it("has a domain with id D_META", () => {
    expect(P0_META.domain.id).toBe("D_META");
  });

  it("has safety bounds configured", () => {
    expect(P0_META.safety.maxLoops).toBe(50);
    expect(P0_META.safety.maxTokens).toBe(2_000_000);
    expect(P0_META.safety.maxCostUsd).toBe(100);
    expect(P0_META.safety.maxDurationMs).toBe(7_200_000);
    expect(P0_META.safety.maxDepth).toBe(5);
  });
});

// ── Transition routing tests ──

describe("evaluateTransition(P0_META, ...)", () => {
  it("arm 1 fires: gap_severity_first when high gap methods exist", () => {
    const result = evaluateTransition(P0_META, stateWithHighGap);
    expect(result.firedArm?.label).toBe("gap_severity_first");
    expect(result.firedArm?.priority).toBe(1);
  });

  it("arm 2 fires: lifecycle_design when informal practices exist", () => {
    const result = evaluateTransition(P0_META, stateWithInformal);
    expect(result.firedArm?.label).toBe("lifecycle_design");
    expect(result.firedArm?.priority).toBe(2);
  });

  it("arm 3 fires: lifecycle_instantiation when methods need instantiation", () => {
    const result = evaluateTransition(P0_META, stateNeedsInstantiation);
    expect(result.firedArm?.label).toBe("lifecycle_instantiation");
    expect(result.firedArm?.priority).toBe(3);
  });

  it("arm 4 fires: structural_composition when composable pairs exist", () => {
    const result = evaluateTransition(P0_META, stateWithComposable);
    expect(result.firedArm?.label).toBe("structural_composition");
    expect(result.firedArm?.priority).toBe(4);
  });

  it("arm 5 fires: structural_audit when compiled methods lack self-consistency", () => {
    const result = evaluateTransition(P0_META, stateNotSelfConsistent);
    expect(result.firedArm?.label).toBe("structural_audit");
    expect(result.firedArm?.priority).toBe(5);
  });

  it("arm 7 fires: discovery when target has uncompiled methods", () => {
    const result = evaluateTransition(P0_META, stateWithUncompiled);
    expect(result.firedArm?.label).toBe("discovery");
    expect(result.firedArm?.priority).toBe(7);
  });

  it("arm 8 fires: terminate when all clean", () => {
    const result = evaluateTransition(P0_META, stateAllClean);
    expect(result.firedArm?.label).toBe("terminate");
    expect(result.firedArm?.priority).toBe(8);
  });

  it("priority: high gap + informal -> arm 1 wins (gap_severity_first)", () => {
    const state: MetaState = {
      targetRegistry: ["M1"],
      compiledMethods: ["M1"],
      highGapMethods: ["M1"],
      needsInstantiation: [],
      composablePairs: [],
      informalPractices: ["code-review"],
      selfConsistentMethods: ["M1"],
    };
    const result = evaluateTransition(P0_META, state);
    expect(result.firedArm?.label).toBe("gap_severity_first");
    expect(result.firedArm?.priority).toBe(1);
  });

  it("priority: informal + needs instantiation -> arm 2 wins (lifecycle_design)", () => {
    const state: MetaState = {
      targetRegistry: ["M1"],
      compiledMethods: ["M1"],
      highGapMethods: [],
      needsInstantiation: ["M1"],
      composablePairs: [],
      informalPractices: ["pairing"],
      selfConsistentMethods: ["M1"],
    };
    const result = evaluateTransition(P0_META, state);
    expect(result.firedArm?.label).toBe("lifecycle_design");
    expect(result.firedArm?.priority).toBe(2);
  });

  it("evaluates all 8 arms and records traces", () => {
    const result = evaluateTransition(P0_META, stateAllClean);
    expect(result.armTraces).toHaveLength(8);

    // Only the terminate arm should fire
    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("terminate");
  });

  it("all arms select null (methods are placeholders)", () => {
    // Since no sub-methods are ported yet, all arms select null
    for (const arm of P0_META.arms) {
      expect(arm.selects).toBeNull();
    }
  });
});

// ── Prompt template tests ──

describe("prompts", () => {
  describe("roleIntro", () => {
    it("renders role and task", () => {
      const prompt = prompts.roleIntro<{ role: string; task: string }>();
      const result = prompt.run({ role: "methodology designer", task: "Design M1-MDES" });
      expect(result).toBe("## Role\nYou are the methodology designer.\n\n## Task\nDesign M1-MDES");
    });

    it("renders different roles", () => {
      const prompt = prompts.roleIntro<{ role: string; task: string }>();
      const result = prompt.run({ role: "auditor", task: "Audit M6" });
      expect(result).toContain("auditor");
      expect(result).toContain("Audit M6");
    });
  });

  describe("deliveryRules", () => {
    it("renders numbered list", () => {
      const prompt = prompts.deliveryRules<{ rules: readonly string[] }>();
      const result = prompt.run({ rules: ["No side effects", "Pure functions only", "Test everything"] });
      expect(result).toBe(
        "## Delivery Rules\n1. No side effects\n2. Pure functions only\n3. Test everything",
      );
    });

    it("renders empty string for empty rules", () => {
      const prompt = prompts.deliveryRules<{ rules: readonly string[] }>();
      const result = prompt.run({ rules: [] });
      expect(result).toBe("");
    });
  });

  describe("insightRequest", () => {
    it("renders topic instruction", () => {
      const prompt = prompts.insightRequest("architecture", 3);
      const result = prompt.run({});
      expect(result).toBe(
        "\n\nAt the end of your response, summarize your architecture findings as 3 bullet points.",
      );
    });

    it("renders different topics and bullet counts", () => {
      const prompt = prompts.insightRequest("gap analysis", 5);
      const result = prompt.run({});
      expect(result).toContain("gap analysis");
      expect(result).toContain("5 bullet points");
    });
  });

  describe("compilationCheck", () => {
    it("renders component checklist", () => {
      const result = prompts.compilationCheck.run({
        components: ["domain theory", "step DAG", "objective predicate"],
      });
      expect(result).toBe(
        "## Compilation Check\nVerify the following components are present and valid:\n- [ ] domain theory\n- [ ] step DAG\n- [ ] objective predicate",
      );
    });

    it("renders single component", () => {
      const result = prompts.compilationCheck.run({ components: ["axioms"] });
      expect(result).toContain("- [ ] axioms");
    });
  });
});
