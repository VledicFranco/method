import { describe, it, expect } from "vitest";
import { compileToTLA, renderTLA, compileProperties, _predicateToTLA, _sanitizeName } from "../compile.js";
import type { Methodology, Arm, SafetyBounds } from "../../methodology/methodology.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Method } from "../../method/method.js";
import type { Predicate } from "../../predicate/predicate.js";
import { TRUE, FALSE, check, and, or, not, implies } from "../../predicate/predicate.js";

// ── Test fixtures ──

type TestState = {
  phase: string;
  progress: number;
};

const testDomain: DomainTheory<TestState> = {
  id: "D-TEST",
  signature: {
    sorts: [{ name: "Phase", description: "Delivery phase", cardinality: "finite" }],
    functionSymbols: [],
    predicates: {},
  },
  axioms: {
    "progress-bounded": check("progress-bounded", (s: TestState) => s.progress >= 0 && s.progress <= 100),
    "phase-valid": check("phase-valid", (s: TestState) => ["planning", "executing", "done"].includes(s.phase)),
  },
};

const testMethodA: Method<TestState> = {
  id: "M-PLAN",
  name: "Planning",
  domain: testDomain,
  roles: [],
  dag: {
    steps: [],
    edges: [],
    initial: "start",
    terminal: "end",
  },
  objective: check("planned", (s) => s.phase === "executing"),
  measures: [],
};

const testMethodB: Method<TestState> = {
  id: "M-EXEC",
  name: "Execution",
  domain: testDomain,
  roles: [],
  dag: {
    steps: [],
    edges: [],
    initial: "start",
    terminal: "end",
  },
  objective: check("completed", (s) => s.phase === "done"),
  measures: [],
};

const testSafety: SafetyBounds = {
  maxLoops: 10,
  maxTokens: 500_000,
  maxCostUsd: 25,
  maxDurationMs: 1_800_000,
  maxDepth: 5,
};

function makeMethodology(arms: Arm<TestState>[]): Methodology<TestState> {
  return {
    id: "PHI-TEST",
    name: "Test Methodology",
    domain: testDomain,
    arms,
    objective: check("done", (s) => s.phase === "done"),
    terminationCertificate: {
      measure: (s) => 100 - s.progress,
      decreases: "Progress monotonically increases.",
    },
    safety: testSafety,
  };
}

const twoArmMethodology = makeMethodology([
  {
    priority: 1,
    label: "terminate",
    condition: check("is-done", (s: TestState) => s.phase === "done"),
    selects: null,
    rationale: "Terminate when done.",
  },
  {
    priority: 2,
    label: "plan-first",
    condition: check("needs-planning", (s: TestState) => s.phase === "planning"),
    selects: testMethodA,
    rationale: "Plan before executing.",
  },
]);

const stateFields = ["phase", "progress"] as const;

// ── compileToTLA ──

describe("compileToTLA", () => {
  it("produces a TLAModule with correct name from methodology id", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.name).toBe("PHI_TEST");
  });

  it("variables include state fields + loop_count + current_method + status", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const varNames = mod.variables.map(v => v.name);
    expect(varNames).toContain("phase");
    expect(varNames).toContain("progress");
    expect(varNames).toContain("loop_count");
    expect(varNames).toContain("current_method");
    expect(varNames).toContain("status");
    expect(mod.variables.length).toBe(5); // 2 state + 3 tracking
  });

  it("state field variables have type 'untyped'", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const phaseVar = mod.variables.find(v => v.name === "phase");
    expect(phaseVar?.type).toBe("untyped");
  });

  it("loop_count variable has type Nat", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const loopVar = mod.variables.find(v => v.name === "loop_count");
    expect(loopVar?.type).toBe("Nat");
  });

  it("extends Naturals and Sequences", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.extends).toEqual(["Naturals", "Sequences"]);
  });

  it("constants include _init suffix for each state field", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.constants).toEqual(["phase_init", "progress_init"]);
  });

  it("Init predicate initializes all variables", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.init.name).toBe("Init");
    expect(mod.init.body).toContain("phase = phase_init");
    expect(mod.init.body).toContain("progress = progress_init");
    expect(mod.init.body).toContain("loop_count = 0");
    expect(mod.init.body).toContain('current_method = "none"');
    expect(mod.init.body).toContain('status = "running"');
  });

  it("Next predicate is disjunction of arm action names", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.next.name).toBe("Next");
    expect(mod.next.body).toBe("Arm_terminate \\/ Arm_plan_first");
  });

  it("definitions contain arm action predicates", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.definitions.length).toBe(2);

    const terminateArm = mod.definitions.find(d => d.name === "Arm_terminate");
    expect(terminateArm).toBeDefined();
    expect(terminateArm!.body).toContain('"none"');
    expect(terminateArm!.body).toContain("loop_count' = loop_count + 1");

    const planArm = mod.definitions.find(d => d.name === "Arm_plan_first");
    expect(planArm).toBeDefined();
    expect(planArm!.body).toContain('"M-PLAN"');
  });

  it("invariants include axioms + BoundedExecution", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const invNames = mod.invariants.map(i => i.name);
    expect(invNames).toContain("Inv_progress_bounded");
    expect(invNames).toContain("Inv_phase_valid");
    expect(invNames).toContain("BoundedExecution");
  });

  it("axiom invariants are marked as opaque comments", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const progressInv = mod.invariants.find(i => i.name === "Inv_progress_bounded");
    expect(progressInv?.body).toContain("opaque check");
    expect(progressInv?.kind).toBe("invariant");
  });

  it("BoundedExecution uses methodology safety.maxLoops", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const bounded = mod.invariants.find(i => i.name === "BoundedExecution");
    expect(bounded?.body).toBe("loop_count <= 10");
  });

  it("properties include Terminates liveness", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    expect(mod.properties.length).toBe(1);
    expect(mod.properties[0].name).toBe("Terminates");
    expect(mod.properties[0].kind).toBe("temporal");
    expect(mod.properties[0].body).toBe('<>(status = "completed")');
  });

  it("arm selecting null (terminate) sets current_method to 'none'", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const termDef = mod.definitions.find(d => d.name === "Arm_terminate");
    expect(termDef!.body).toContain('current_method\' = "none"');
  });

  it("arm selecting a method sets current_method to method id", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const planDef = mod.definitions.find(d => d.name === "Arm_plan_first");
    expect(planDef!.body).toContain('current_method\' = "M-PLAN"');
  });
});

// ── renderTLA ──

describe("renderTLA", () => {
  it("produces valid TLA+ syntax with MODULE ... ==== structure", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toMatch(/^---- MODULE PHI_TEST ----/);
    expect(output).toMatch(/====$/);
  });

  it("includes EXTENDS section", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("EXTENDS Naturals, Sequences");
  });

  it("includes CONSTANTS section", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("CONSTANTS phase_init, progress_init");
  });

  it("includes VARIABLES section", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("VARIABLES phase, progress, loop_count, current_method, status");
  });

  it("includes arm action definitions before Init", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("Arm_terminate ==");
    expect(output).toContain("Arm_plan_first ==");
    // Arm definitions should come before Init
    const armPos = output.indexOf("Arm_terminate ==");
    const initPos = output.indexOf("Init ==");
    expect(armPos).toBeLessThan(initPos);
  });

  it("includes Init predicate", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("Init ==");
    expect(output).toContain("phase = phase_init");
  });

  it("includes Next predicate", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("Next ==");
    expect(output).toContain("Arm_terminate \\/ Arm_plan_first");
  });

  it("includes invariant definitions", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain("BoundedExecution == loop_count <= 10");
  });

  it("includes property definitions", () => {
    const mod = compileToTLA(twoArmMethodology, stateFields);
    const output = renderTLA(mod);
    expect(output).toContain('Terminates == <>(status = "completed")');
  });

  it("omits CONSTANTS section when no constants", () => {
    const mod = compileToTLA(twoArmMethodology, []);
    const output = renderTLA(mod);
    expect(output).not.toContain("CONSTANTS");
  });
});

// ── compileProperties ──

describe("compileProperties", () => {
  it("includes SPECIFICATION line", () => {
    const cfg = compileProperties(twoArmMethodology);
    expect(cfg).toContain("SPECIFICATION Spec");
  });

  it("includes BoundedExecution INVARIANT", () => {
    const cfg = compileProperties(twoArmMethodology);
    expect(cfg).toContain("INVARIANT BoundedExecution");
  });

  it("includes axiom invariants", () => {
    const cfg = compileProperties(twoArmMethodology);
    expect(cfg).toContain("INVARIANT Inv_progress_bounded");
    expect(cfg).toContain("INVARIANT Inv_phase_valid");
  });

  it("includes Terminates PROPERTY", () => {
    const cfg = compileProperties(twoArmMethodology);
    expect(cfg).toContain("PROPERTY Terminates");
  });

  it("produces correctly ordered lines", () => {
    const cfg = compileProperties(twoArmMethodology);
    const lines = cfg.split("\n");
    expect(lines[0]).toBe("SPECIFICATION Spec");
    expect(lines[1]).toBe("INVARIANT BoundedExecution");
    // Axiom invariants in the middle
    expect(lines[lines.length - 1]).toBe("PROPERTY Terminates");
  });
});

// ── predicateToTLA ──

describe("predicateToTLA", () => {
  it("val(true) -> TRUE", () => {
    expect(_predicateToTLA(TRUE)).toBe("TRUE");
  });

  it("val(false) -> FALSE", () => {
    expect(_predicateToTLA(FALSE)).toBe("FALSE");
  });

  it("check -> comment with label", () => {
    const pred = check("my-check", () => true);
    expect(_predicateToTLA(pred)).toBe("\\* check: my-check");
  });

  it("and -> /\\", () => {
    const pred = and(TRUE, FALSE);
    expect(_predicateToTLA(pred)).toBe("(TRUE /\\ FALSE)");
  });

  it("or -> \\/", () => {
    const pred = or(TRUE, FALSE);
    expect(_predicateToTLA(pred)).toBe("(TRUE \\/ FALSE)");
  });

  it("not -> ~", () => {
    const pred = not(TRUE);
    expect(_predicateToTLA(pred)).toBe("~(TRUE)");
  });

  it("implies -> =>", () => {
    const pred = implies(TRUE, FALSE);
    expect(_predicateToTLA(pred)).toBe("(TRUE => FALSE)");
  });

  it("nested and/or renders correctly", () => {
    const pred = and(or(TRUE, FALSE), not(TRUE));
    expect(_predicateToTLA(pred)).toBe("((TRUE \\/ FALSE) /\\ ~(TRUE))");
  });

  it("forall -> \\A x \\in Domain", () => {
    const pred: Predicate<any> = {
      tag: "forall",
      label: "all-items",
      elements: () => [],
      body: TRUE,
    };
    expect(_predicateToTLA(pred)).toBe("\\A x \\in Domain : TRUE");
  });

  it("exists -> \\E x \\in Domain", () => {
    const pred: Predicate<any> = {
      tag: "exists",
      label: "some-item",
      elements: () => [],
      body: FALSE,
    };
    expect(_predicateToTLA(pred)).toBe("\\E x \\in Domain : FALSE");
  });
});

// ── sanitizeName ──

describe("sanitizeName", () => {
  it("passes through alphanumeric and underscores", () => {
    expect(_sanitizeName("hello_world_42")).toBe("hello_world_42");
  });

  it("replaces hyphens with underscores", () => {
    expect(_sanitizeName("my-method")).toBe("my_method");
  });

  it("replaces dots with underscores", () => {
    expect(_sanitizeName("v2.0")).toBe("v2_0");
  });

  it("replaces spaces with underscores", () => {
    expect(_sanitizeName("hello world")).toBe("hello_world");
  });

  it("replaces multiple special chars", () => {
    expect(_sanitizeName("PHI-TEST/v2.0")).toBe("PHI_TEST_v2_0");
  });

  it("handles empty string", () => {
    expect(_sanitizeName("")).toBe("");
  });
});
