// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  loadMethodFromYamlString,
  loadMethodFromFile,
  loadMethodologyFromYamlString,
  loadMethodologyFromFile,
  convertDomain,
} from "../yaml-adapter.js";
import { parsePredicate, parseReturns } from "../predicate-parser.js";
import { evaluate } from "../../predicate/evaluate.js";
// TRUE predicate is used via evaluate() in assertions below
import type { YamlDomainTheory } from "../yaml-types.js";

// ── Registry path (relative to worktree root) ──

const REGISTRY_PATH = join(__dirname, "../../../../../registry");

// ── parsePredicate ──

describe("parsePredicate", () => {
  it("null returns TRUE", () => {
    const pred = parsePredicate<Record<string, unknown>>(null);
    expect(evaluate(pred, {})).toBe(true);
    expect(pred.tag).toBe("val");
  });

  it("undefined returns TRUE", () => {
    const pred = parsePredicate<Record<string, unknown>>(undefined);
    expect(evaluate(pred, {})).toBe(true);
  });

  it("empty string returns TRUE", () => {
    const pred = parsePredicate<Record<string, unknown>>("");
    expect(evaluate(pred, {})).toBe(true);
  });

  it("whitespace-only string returns TRUE", () => {
    const pred = parsePredicate<Record<string, unknown>>("   ");
    expect(evaluate(pred, {})).toBe(true);
  });

  it("non-empty string returns a check with the label", () => {
    const pred = parsePredicate<Record<string, unknown>>("Domain knowledge available");
    expect(pred.tag).toBe("check");
    if (pred.tag === "check") {
      expect(pred.label).toBe("Domain knowledge available");
    }
    // Natural language predicates always evaluate to true
    expect(evaluate(pred, {})).toBe(true);
  });

  it("trims whitespace from the label", () => {
    const pred = parsePredicate<Record<string, unknown>>("  some condition  ");
    if (pred.tag === "check") {
      expect(pred.label).toBe("some condition");
    }
  });
});

// ── parseReturns ──

describe("parseReturns", () => {
  it("'Some(M1-MDES)' returns 'M1-MDES'", () => {
    expect(parseReturns("Some(M1-MDES)")).toBe("M1-MDES");
  });

  it("'Some(M3-MEVO)' returns 'M3-MEVO'", () => {
    expect(parseReturns("Some(M3-MEVO)")).toBe("M3-MEVO");
  });

  it("'None' returns null", () => {
    expect(parseReturns("None")).toBeNull();
  });

  it("null returns null", () => {
    expect(parseReturns(null)).toBeNull();
  });

  it("undefined returns null", () => {
    expect(parseReturns(undefined)).toBeNull();
  });

  it("bare method ID returns the ID", () => {
    expect(parseReturns("M5-MCOM")).toBe("M5-MCOM");
  });
});

// ── convertDomain ──

describe("convertDomain", () => {
  const rawDomain: YamlDomainTheory = {
    id: "D_TEST",
    sorts: [
      { name: "Entity", description: "A test entity", cardinality: "unbounded" },
      { name: "Status", description: "A status enum", cardinality: "finite" },
      { name: "Config", description: "Singleton config", cardinality: "singleton" },
    ],
    predicates: [
      { name: "active", signature: "Entity", description: "Entity is active" },
      { name: "valid", signature: "Entity x Status", description: "Entity has valid status" },
    ],
    function_symbols: [
      { name: "status_of", signature: "Entity -> Status", totality: "total" },
      { name: "priority", signature: "Entity x Status -> Entity", totality: "partial" },
    ],
    axioms: [
      { id: "Ax-1", statement: "forall e. active(e) -> valid(e, status_of(e))" },
      { id: "Ax-2", statement: "forall e. valid(e, s) -> active(e)" },
    ],
  };

  it("maps sorts correctly", () => {
    const domain = convertDomain(rawDomain);
    expect(domain.id).toBe("D_TEST");
    expect(domain.signature.sorts).toHaveLength(3);
    expect(domain.signature.sorts[0]).toEqual({
      name: "Entity",
      description: "A test entity",
      cardinality: "unbounded",
    });
    expect(domain.signature.sorts[1].cardinality).toBe("finite");
    expect(domain.signature.sorts[2].cardinality).toBe("singleton");
  });

  it("maps predicates correctly", () => {
    const domain = convertDomain(rawDomain);
    expect(Object.keys(domain.signature.predicates)).toEqual(["active", "valid"]);
    // Predicates from YAML are labeled checks
    const activePred = domain.signature.predicates["active"];
    expect(activePred.tag).toBe("check");
    if (activePred.tag === "check") {
      expect(activePred.label).toBe("Entity is active");
    }
  });

  it("maps function symbols correctly", () => {
    const domain = convertDomain(rawDomain);
    expect(domain.signature.functionSymbols).toHaveLength(2);

    const statusFn = domain.signature.functionSymbols[0];
    expect(statusFn.name).toBe("status_of");
    expect(statusFn.inputSorts).toEqual(["Entity"]);
    expect(statusFn.outputSort).toBe("Status");
    expect(statusFn.totality).toBe("total");

    const priorityFn = domain.signature.functionSymbols[1];
    expect(priorityFn.inputSorts).toEqual(["Entity", "Status"]);
    expect(priorityFn.outputSort).toBe("Entity");
    expect(priorityFn.totality).toBe("partial");
  });

  it("maps axioms correctly", () => {
    const domain = convertDomain(rawDomain);
    expect(Object.keys(domain.axioms)).toEqual(["Ax-1", "Ax-2"]);
    // Axioms are labeled checks that always pass
    expect(evaluate(domain.axioms["Ax-1"], {})).toBe(true);
  });

  it("handles missing optional fields gracefully", () => {
    const minimal: YamlDomainTheory = { id: "D_EMPTY" };
    const domain = convertDomain(minimal);
    expect(domain.id).toBe("D_EMPTY");
    expect(domain.signature.sorts).toEqual([]);
    expect(domain.signature.functionSymbols).toEqual([]);
    expect(Object.keys(domain.signature.predicates)).toEqual([]);
    expect(Object.keys(domain.axioms)).toEqual([]);
  });
});

// ── loadMethodFromYamlString ──

describe("loadMethodFromYamlString", () => {
  const simpleMethodYaml = `
method:
  id: M-TEST
  name: "Test Method"
  objective: "All tests pass"
phases:
  - id: sigma_0
    name: "Setup"
    role: tester
    precondition: "Environment ready"
    postcondition: "Setup complete"
    guidance: "Prepare the test environment"
  - id: sigma_1
    name: "Execute"
    role: tester
    precondition: "Setup complete"
    postcondition: "Tests executed"
    guidance: "Run all tests"
  - id: sigma_2
    name: "Report"
    role: reviewer
    precondition: "Tests executed"
    postcondition: "Report generated"
    guidance: "Generate the test report"
roles:
  - id: tester
    description: "Runs the tests"
  - id: reviewer
    description: "Reviews results"
domain_theory:
  id: D_TEST
  sorts:
    - name: TestCase
      description: "A test case"
      cardinality: unbounded
  predicates:
    - name: passing
      signature: "TestCase"
      description: "Test case is passing"
  axioms:
    - id: Ax-1
      statement: "forall t. passing(t) -> executed(t)"
`;

  it("parses method id and name", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.id).toBe("M-TEST");
    expect(method.name).toBe("Test Method");
  });

  it("creates correct number of steps from phases", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.dag.steps).toHaveLength(3);
  });

  it("maps step ids, names, and roles", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    const [s0, s1, s2] = method.dag.steps;

    expect(s0.id).toBe("sigma_0");
    expect(s0.name).toBe("Setup");
    expect(s0.role).toBe("tester");

    expect(s1.id).toBe("sigma_1");
    expect(s1.name).toBe("Execute");
    expect(s1.role).toBe("tester");

    expect(s2.id).toBe("sigma_2");
    expect(s2.name).toBe("Report");
    expect(s2.role).toBe("reviewer");
  });

  it("builds a linear DAG with sequential edges", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.dag.initial).toBe("sigma_0");
    expect(method.dag.terminal).toBe("sigma_2");
    expect(method.dag.edges).toEqual([
      { from: "sigma_0", to: "sigma_1" },
      { from: "sigma_1", to: "sigma_2" },
    ]);
  });

  it("maps preconditions and postconditions as predicates", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    const step = method.dag.steps[0];
    expect(step.precondition.tag).toBe("check");
    if (step.precondition.tag === "check") {
      expect(step.precondition.label).toBe("Environment ready");
    }
    expect(step.postcondition.tag).toBe("check");
    if (step.postcondition.tag === "check") {
      expect(step.postcondition.label).toBe("Setup complete");
    }
  });

  it("uses script execution with identity function", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    const step = method.dag.steps[0];
    expect(step.execution.tag).toBe("script");
  });

  it("maps roles correctly", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.roles).toHaveLength(2);
    expect(method.roles[0].id).toBe("tester");
    expect(method.roles[0].description).toBe("Runs the tests");
    expect(method.roles[1].id).toBe("reviewer");
  });

  it("maps domain theory", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.domain.id).toBe("D_TEST");
    expect(method.domain.signature.sorts).toHaveLength(1);
    expect(method.domain.signature.sorts[0].name).toBe("TestCase");
  });

  it("maps objective predicate", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.objective.tag).toBe("check");
    if (method.objective.tag === "check") {
      expect(method.objective.label).toBe("All tests pass");
    }
  });

  it("returns empty measures array", () => {
    const method = loadMethodFromYamlString(simpleMethodYaml);
    expect(method.measures).toEqual([]);
  });
});

// ── loadMethodologyFromYamlString ──

describe("loadMethodologyFromYamlString", () => {
  const simpleMethodologyYaml = `
methodology:
  id: P-TEST
  name: "Test Methodology"
  version: "1.0"
domain_theory:
  id: D_P_TEST
  sorts:
    - name: Task
      description: "A unit of work"
      cardinality: unbounded
  predicates:
    - name: complete
      signature: "Task"
      description: "Task is complete"
  axioms:
    - id: Ax-1
      statement: "forall t. complete(t) -> assigned(t)"
transition_function:
  id: delta_TEST
  arms:
    - priority: 1
      label: severity_first
      condition: "exists t. has_bug(t) and severity(t) = CRITICAL"
      selects: M-FIX
      rationale: "Fix critical bugs first"
    - priority: 2
      label: normal_work
      condition: "exists t. NOT complete(t)"
      selects: M-WORK
      rationale: "Process remaining tasks"
    - priority: 3
      label: terminate
      condition: "All tasks complete"
      selects: None
      rationale: "Done when all tasks are complete"
`;

  it("parses methodology id and name", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.id).toBe("P-TEST");
    expect(methodology.name).toBe("Test Methodology");
  });

  it("creates correct number of arms", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.arms).toHaveLength(3);
  });

  it("maps arm priorities and labels", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.arms[0].priority).toBe(1);
    expect(methodology.arms[0].label).toBe("severity_first");
    expect(methodology.arms[1].priority).toBe(2);
    expect(methodology.arms[1].label).toBe("normal_work");
    expect(methodology.arms[2].priority).toBe(3);
    expect(methodology.arms[2].label).toBe("terminate");
  });

  it("maps arm conditions as predicates", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    const cond = methodology.arms[0].condition;
    expect(cond.tag).toBe("check");
    if (cond.tag === "check") {
      expect(cond.label).toBe("exists t. has_bug(t) and severity(t) = CRITICAL");
    }
  });

  it("maps arm selects to stub Method or null", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    // First arm selects a method
    expect(methodology.arms[0].selects).not.toBeNull();
    expect(methodology.arms[0].selects?.id).toBe("M-FIX");
    // Second arm selects a method
    expect(methodology.arms[1].selects?.id).toBe("M-WORK");
    // Third arm is termination (None)
    expect(methodology.arms[2].selects).toBeNull();
  });

  it("maps arm rationale", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.arms[0].rationale).toBe("Fix critical bugs first");
  });

  it("maps domain theory", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.domain.id).toBe("D_P_TEST");
    expect(methodology.domain.signature.sorts).toHaveLength(1);
  });

  it("provides default safety bounds", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(methodology.safety.maxLoops).toBeGreaterThan(0);
    expect(methodology.safety.maxTokens).toBeGreaterThan(0);
  });

  it("provides default termination certificate", () => {
    const methodology = loadMethodologyFromYamlString(simpleMethodologyYaml);
    expect(typeof methodology.terminationCertificate.measure).toBe("function");
    expect(methodology.terminationCertificate.decreases).toContain("YAML");
  });
});

// ── loadMethodFromFile (real registry) ──

describe("loadMethodFromFile", () => {
  it("loads M1-MDES from the actual registry", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    expect(method.id).toBe("M1-MDES");
    expect(method.name).toBe("Method Design from Established Domain Knowledge");
    expect(method.domain.id).toBe("D_MDES");
  });

  it("has the correct step count matching YAML phases", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    // M1-MDES has phases sigma_0 through sigma_6 = 7 steps
    expect(method.dag.steps.length).toBe(7);
    expect(method.dag.initial).toBe("sigma_0");
    expect(method.dag.terminal).toBe("sigma_6");
  });

  it("maps roles from the real YAML", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    const roleIds = method.roles.map((r) => r.id);
    expect(roleIds).toContain("designer");
    expect(roleIds).toContain("compiler");
  });

  it("maps domain sorts from the real YAML", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    const sortNames = method.domain.signature.sorts.map((s) => s.name);
    expect(sortNames).toContain("KnowledgeCorpus");
    expect(sortNames).toContain("MethodCandidate");
    expect(sortNames).toContain("Gate");
  });

  it("maps domain predicates from the real YAML", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    const predNames = Object.keys(method.domain.signature.predicates);
    expect(predNames).toContain("corpus_loaded");
    expect(predNames).toContain("compiled");
  });

  it("maps domain axioms from the real YAML", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    const axiomKeys = Object.keys(method.domain.axioms);
    expect(axiomKeys).toContain("Ax-1");
  });

  it("throws for missing file", () => {
    expect(() =>
      loadMethodFromFile(REGISTRY_PATH, "P0-META", "M99-NONEXISTENT"),
    ).toThrow("Method file not found");
  });
});

// ── loadMethodologyFromFile (real registry) ──

describe("loadMethodologyFromFile", () => {
  it("loads P0-META from the actual registry", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    expect(methodology.id).toBe("P0-META");
    expect(methodology.name).toContain("Genesis");
  });

  it("has the correct number of arms from transition_function", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    // P0-META has 8 arms (priority 1-8)
    expect(methodology.arms.length).toBe(8);
  });

  it("maps arm labels from the real YAML", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    const labels = methodology.arms.map((a) => a.label);
    expect(labels).toContain("gap_severity_first");
    expect(labels).toContain("terminate");
  });

  it("maps domain theory from the real YAML", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    expect(methodology.domain.id).toBe("D_META");
    const sortNames = methodology.domain.signature.sorts.map((s) => s.name);
    expect(sortNames).toContain("Method");
    expect(sortNames).toContain("Methodology");
  });

  it("first arm selects M3-MEVO", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    expect(methodology.arms[0].selects?.id).toBe("M3-MEVO");
  });

  it("last arm (terminate) selects null", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    const lastArm = methodology.arms[methodology.arms.length - 1];
    expect(lastArm.label).toBe("terminate");
    expect(lastArm.selects).toBeNull();
  });

  it("throws for missing file", () => {
    expect(() =>
      loadMethodologyFromFile(REGISTRY_PATH, "P99-NONEXISTENT"),
    ).toThrow("Methodology file not found");
  });
});

// ── Round-trip consistency ──

describe("round-trip consistency", () => {
  it("loaded method step count matches phases in the YAML", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    // The linear DAG should have (steps - 1) edges
    expect(method.dag.edges.length).toBe(method.dag.steps.length - 1);
  });

  it("loaded methodology arm priorities are monotonically increasing", () => {
    const methodology = loadMethodologyFromFile(REGISTRY_PATH, "P0-META");
    for (let i = 0; i < methodology.arms.length - 1; i++) {
      expect(methodology.arms[i].priority).toBeLessThan(methodology.arms[i + 1].priority);
    }
  });

  it("all loaded steps have script execution", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    for (const step of method.dag.steps) {
      expect(step.execution.tag).toBe("script");
    }
  });

  it("all loaded predicates evaluate to true (natural language pass-through)", () => {
    const method = loadMethodFromFile(REGISTRY_PATH, "P0-META", "M1-MDES");
    for (const step of method.dag.steps) {
      expect(evaluate(step.precondition, {})).toBe(true);
      expect(evaluate(step.postcondition, {})).toBe(true);
    }
  });
});

// ── Edge cases ──

describe("edge cases", () => {
  it("handles method YAML with no phases", () => {
    const yaml = `
method:
  id: M-EMPTY
  name: "Empty Method"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.id).toBe("M-EMPTY");
    expect(method.dag.steps).toHaveLength(0);
    expect(method.dag.edges).toHaveLength(0);
    expect(method.dag.initial).toBe("");
    expect(method.dag.terminal).toBe("");
  });

  it("handles method YAML with no roles", () => {
    const yaml = `
method:
  id: M-NOROLES
  name: "No Roles"
phases:
  - id: s0
    name: "Only Step"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles).toHaveLength(0);
    expect(method.dag.steps).toHaveLength(1);
    expect(method.dag.steps[0].role).toBe("default");
  });

  it("handles methodology YAML with no arms", () => {
    const yaml = `
methodology:
  id: P-NOARMS
  name: "No Arms"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms).toHaveLength(0);
  });

  it("handles methodology YAML with returns field instead of selects", () => {
    const yaml = `
methodology:
  id: P-RETURNS
  name: "Returns Style"
transition_function:
  id: delta_RET
  arms:
    - priority: 1
      label: go
      condition: "always"
      returns: "Some(M-GO)"
      rationale: "test"
    - priority: 2
      label: stop
      condition: "done"
      returns: "None"
      rationale: "test"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].selects?.id).toBe("M-GO");
    expect(methodology.arms[1].selects).toBeNull();
  });

  it("handles function signature with Option() return type", () => {
    const rawDomain: YamlDomainTheory = {
      id: "D_OPT",
      function_symbols: [
        { name: "gate_verdict", signature: "Candidate x Gate -> Option(Verdict)", totality: "partial" },
      ],
    };
    const domain = convertDomain(rawDomain);
    expect(domain.signature.functionSymbols[0].outputSort).toBe("Verdict");
    expect(domain.signature.functionSymbols[0].inputSorts).toEqual(["Candidate", "Gate"]);
  });
});

// ── convertMethod — default/fallback branches ──

describe("convertMethod fallback branches", () => {
  it("defaults id to 'unknown' when method section has no id", () => {
    const yaml = `
method:
  name: "Has Name"
`;
    // method.id is undefined → ?? "unknown"
    const method = loadMethodFromYamlString(yaml);
    expect(method.id).toBe("unknown");
    expect(method.name).toBe("Has Name");
  });

  it("defaults name to 'Unknown Method' when method section has no name", () => {
    const yaml = `
method:
  id: M-NONAME
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.id).toBe("M-NONAME");
    expect(method.name).toBe("Unknown Method");
  });

  it("defaults both id and name when method section is missing entirely", () => {
    const yaml = `
phases:
  - id: s0
    name: "Step Zero"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.id).toBe("unknown");
    expect(method.name).toBe("Unknown Method");
  });

  it("uses emptyDomain when no domain_theory is provided", () => {
    const yaml = `
method:
  id: M-NODOMAIN
  name: "No Domain"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.domain.id).toBe("empty");
    expect(method.domain.signature.sorts).toEqual([]);
    expect(method.domain.signature.functionSymbols).toEqual([]);
    expect(Object.keys(method.domain.signature.predicates)).toEqual([]);
    expect(Object.keys(method.domain.axioms)).toEqual([]);
  });

  it("defaults objective to TRUE when method has no objective field", () => {
    const yaml = `
method:
  id: M-NOOBJ
  name: "No Objective"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(evaluate(method.objective, {})).toBe(true);
    expect(method.objective.tag).toBe("val");
  });
});

// ── convertMethodology — default/fallback branches ──

describe("convertMethodology fallback branches", () => {
  it("defaults id to 'unknown' when methodology section has no id", () => {
    const yaml = `
methodology:
  name: "Has Name"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.id).toBe("unknown");
    expect(methodology.name).toBe("Has Name");
  });

  it("defaults name to 'Unknown Methodology' when methodology section has no name", () => {
    const yaml = `
methodology:
  id: P-NONAME
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.id).toBe("P-NONAME");
    expect(methodology.name).toBe("Unknown Methodology");
  });

  it("defaults both id and name when methodology section is missing entirely", () => {
    const yaml = `
transition_function:
  id: delta_orphan
  arms: []
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.id).toBe("unknown");
    expect(methodology.name).toBe("Unknown Methodology");
  });

  it("provides specific default safety bounds values", () => {
    const yaml = `
methodology:
  id: P-BOUNDS
  name: "Safety Bounds Check"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.safety.maxLoops).toBe(100);
    expect(methodology.safety.maxTokens).toBe(10_000_000);
    expect(methodology.safety.maxCostUsd).toBe(500);
    expect(methodology.safety.maxDurationMs).toBe(86_400_000);
    expect(methodology.safety.maxDepth).toBe(10);
  });

  it("provides default termination certificate with measure function returning 1", () => {
    const yaml = `
methodology:
  id: P-CERT
  name: "Termination Check"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.terminationCertificate.measure({})).toBe(1);
    expect(methodology.terminationCertificate.decreases).toContain("YAML");
  });

  it("uses TRUE as the objective", () => {
    const yaml = `
methodology:
  id: P-OBJ
  name: "Objective Check"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(evaluate(methodology.objective, {})).toBe(true);
  });
});

// ── convertStep — guidance and role branches ──

describe("convertStep branches", () => {
  it("attaches _guidance Prompt when step has guidance field", () => {
    const yaml = `
method:
  id: M-GUIDANCE
  name: "Guidance Test"
phases:
  - id: s0
    name: "Guided Step"
    guidance: "Follow the yellow brick road"
`;
    const method = loadMethodFromYamlString(yaml);
    const step = method.dag.steps[0] as any;
    expect(step._guidance).toBeDefined();
    // The Prompt wraps a function that returns the guidance string
    expect(step._guidance.run({})).toBe("Follow the yellow brick road");
  });

  it("does not attach _guidance when guidance field is absent", () => {
    const yaml = `
method:
  id: M-NOGUIDANCE
  name: "No Guidance"
phases:
  - id: s0
    name: "Unguided Step"
`;
    const method = loadMethodFromYamlString(yaml);
    const step = method.dag.steps[0] as any;
    expect(step._guidance).toBeUndefined();
  });

  it("defaults role to 'default' when not specified", () => {
    const yaml = `
method:
  id: M-DEFR
  name: "Default Role"
phases:
  - id: s0
    name: "No Role Specified"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.dag.steps[0].role).toBe("default");
  });

  it("assigns 'script' tag to execution for all YAML-loaded steps", () => {
    const yaml = `
method:
  id: M-EXEC
  name: "Execution Tag"
phases:
  - id: s0
    name: "Step A"
  - id: s1
    name: "Step B"
`;
    const method = loadMethodFromYamlString(yaml);
    for (const step of method.dag.steps) {
      expect(step.execution.tag).toBe("script");
    }
  });

  it("parses precondition and postcondition as predicates", () => {
    const yaml = `
method:
  id: M-COND
  name: "Conditions"
phases:
  - id: s0
    name: "Conditioned"
    precondition: "Data loaded"
    postcondition: "Data validated"
`;
    const method = loadMethodFromYamlString(yaml);
    const step = method.dag.steps[0];
    expect(step.precondition.tag).toBe("check");
    expect(step.postcondition.tag).toBe("check");
    if (step.precondition.tag === "check") {
      expect(step.precondition.label).toBe("Data loaded");
    }
    if (step.postcondition.tag === "check") {
      expect(step.postcondition.label).toBe("Data validated");
    }
  });

  it("defaults precondition and postcondition to TRUE when absent", () => {
    const yaml = `
method:
  id: M-NOCOND
  name: "No Conditions"
phases:
  - id: s0
    name: "No Pre/Post"
`;
    const method = loadMethodFromYamlString(yaml);
    const step = method.dag.steps[0];
    expect(step.precondition.tag).toBe("val");
    expect(step.postcondition.tag).toBe("val");
    expect(evaluate(step.precondition, {})).toBe(true);
    expect(evaluate(step.postcondition, {})).toBe(true);
  });
});

// ── convertRole — authorized_transitions and not_authorized ──

describe("convertRole branches", () => {
  it("maps authorized list from role", () => {
    const yaml = `
method:
  id: M-ROLE-AUTH
  name: "Role Auth"
roles:
  - id: engineer
    description: "The engineer role"
    authorized:
      - sigma_0
      - sigma_1
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles[0].authorized).toEqual(["sigma_0", "sigma_1"]);
  });

  it("maps authorized_transitions when authorized is absent", () => {
    const yaml = `
method:
  id: M-ROLE-TRANS
  name: "Role Transitions"
roles:
  - id: designer
    authorized_transitions:
      - sigma_2
      - sigma_3
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles[0].authorized).toEqual(["sigma_2", "sigma_3"]);
  });

  it("maps not_authorized list", () => {
    const yaml = `
method:
  id: M-ROLE-NOTAUTH
  name: "Role Not Auth"
roles:
  - id: observer
    description: "Read-only observer"
    not_authorized:
      - sigma_0
      - sigma_1
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles[0].notAuthorized).toEqual(["sigma_0", "sigma_1"]);
  });

  it("defaults description to empty string when absent", () => {
    const yaml = `
method:
  id: M-ROLE-NODESC
  name: "Role No Desc"
roles:
  - id: minimal
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles[0].description).toBe("");
  });

  it("provides observe function that returns the state", () => {
    const yaml = `
method:
  id: M-ROLE-OBS
  name: "Role Observe"
roles:
  - id: viewer
    description: "A viewer"
`;
    const method = loadMethodFromYamlString(yaml);
    const state = { foo: "bar", count: 42 };
    expect(method.roles[0].observe(state)).toBe(state);
  });

  it("defaults authorized and notAuthorized to empty arrays", () => {
    const yaml = `
method:
  id: M-ROLE-DEFAULTS
  name: "Role Defaults"
roles:
  - id: bare
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.roles[0].authorized).toEqual([]);
    expect(method.roles[0].notAuthorized).toEqual([]);
  });
});

// ── convertArm — selects vs returns precedence ──

describe("convertArm branches", () => {
  it("uses selects field when both selects and returns are present", () => {
    const yaml = `
methodology:
  id: P-BOTH
  name: "Both Fields"
transition_function:
  id: delta_both
  arms:
    - priority: 1
      label: both
      condition: "always"
      selects: M-VIA-SELECTS
      returns: "Some(M-VIA-RETURNS)"
      rationale: "selects should win"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].selects?.id).toBe("M-VIA-SELECTS");
  });

  it("uses returns field when selects is absent", () => {
    const yaml = `
methodology:
  id: P-RETURNS-ONLY
  name: "Returns Only"
transition_function:
  id: delta_ret
  arms:
    - priority: 1
      label: via_returns
      condition: "exists x"
      returns: "Some(M-RET)"
      rationale: "using returns"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].selects?.id).toBe("M-RET");
  });

  it("selects null when returns is None", () => {
    const yaml = `
methodology:
  id: P-NONE
  name: "None Return"
transition_function:
  id: delta_none
  arms:
    - priority: 1
      label: stop
      condition: "done"
      returns: "None"
      rationale: "terminate"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].selects).toBeNull();
  });

  it("selects null when neither selects nor returns is present", () => {
    const yaml = `
methodology:
  id: P-NOSEL
  name: "No Selection"
transition_function:
  id: delta_nosel
  arms:
    - priority: 1
      label: empty_arm
      condition: "always"
      rationale: "no selection"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].selects).toBeNull();
  });

  it("defaults rationale to empty string when absent", () => {
    const yaml = `
methodology:
  id: P-NORAT
  name: "No Rationale"
transition_function:
  id: delta_norat
  arms:
    - priority: 1
      label: quiet
      condition: "always"
      selects: M-QUIET
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    expect(methodology.arms[0].rationale).toBe("");
  });

  it("stub method has correct structure", () => {
    const yaml = `
methodology:
  id: P-STUB
  name: "Stub Test"
transition_function:
  id: delta_stub
  arms:
    - priority: 1
      label: select
      condition: "always"
      selects: M-STUB
      rationale: "test stub"
`;
    const methodology = loadMethodologyFromYamlString(yaml);
    const stubbed = methodology.arms[0].selects!;
    expect(stubbed.id).toBe("M-STUB");
    expect(stubbed.name).toBe("M-STUB");
    expect(stubbed.domain.id).toBe("empty");
    expect(stubbed.roles).toEqual([]);
    expect(stubbed.dag.steps).toEqual([]);
    expect(stubbed.dag.edges).toEqual([]);
    expect(stubbed.dag.initial).toBe("");
    expect(stubbed.dag.terminal).toBe("");
    expect(stubbed.measures).toEqual([]);
  });
});

// ── buildLinearDAG — various step counts ──

describe("buildLinearDAG via loadMethodFromYamlString", () => {
  it("single step: DAG initial = terminal, no edges", () => {
    const yaml = `
method:
  id: M-ONE
  name: "One Step"
phases:
  - id: only
    name: "Only"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.dag.steps).toHaveLength(1);
    expect(method.dag.initial).toBe("only");
    expect(method.dag.terminal).toBe("only");
    expect(method.dag.edges).toEqual([]);
  });

  it("four steps: 3 edges, correct initial/terminal", () => {
    const yaml = `
method:
  id: M-FOUR
  name: "Four Steps"
phases:
  - id: a
    name: "A"
  - id: b
    name: "B"
  - id: c
    name: "C"
  - id: d
    name: "D"
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.dag.steps).toHaveLength(4);
    expect(method.dag.initial).toBe("a");
    expect(method.dag.terminal).toBe("d");
    expect(method.dag.edges).toHaveLength(3);
    expect(method.dag.edges).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ]);
  });

  it("zero steps: empty DAG", () => {
    const yaml = `
method:
  id: M-ZERO
  name: "Zero Steps"
phases: []
`;
    const method = loadMethodFromYamlString(yaml);
    expect(method.dag.steps).toHaveLength(0);
    expect(method.dag.initial).toBe("");
    expect(method.dag.terminal).toBe("");
    expect(method.dag.edges).toEqual([]);
  });
});

// ── normalizeCardinality — all branches via convertDomain ──

describe("normalizeCardinality branches via convertDomain", () => {
  it("maps 'finite' correctly", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [{ name: "A", cardinality: "finite" }],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("finite");
  });

  it("maps 'singleton' correctly", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [{ name: "A", cardinality: "singleton" }],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("singleton");
  });

  it("maps 'unbounded' correctly", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [{ name: "A", cardinality: "unbounded" }],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("unbounded");
  });

  it("defaults undefined cardinality to 'unbounded'", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [{ name: "A" }],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("unbounded");
  });

  it("maps unknown string (e.g. 'infinite') to 'unbounded'", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [{ name: "A", cardinality: "infinite" }],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("unbounded");
  });

  it("handles case-insensitive cardinality values", () => {
    const domain = convertDomain({
      id: "D_CARD",
      sorts: [
        { name: "A", cardinality: "FINITE" },
        { name: "B", cardinality: "Singleton" },
      ],
    });
    expect(domain.signature.sorts[0].cardinality).toBe("finite");
    expect(domain.signature.sorts[1].cardinality).toBe("singleton");
  });
});

// ── parseSignature — all branches via convertDomain ──

describe("parseSignature branches via convertDomain", () => {
  it("handles undefined signature (no signature field)", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "no_sig" }],
    });
    expect(domain.signature.functionSymbols[0].inputSorts).toEqual([]);
    expect(domain.signature.functionSymbols[0].outputSort).toBe("unknown");
  });

  it("handles signature with no arrow (bare type)", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "bare_type", signature: "Status" }],
    });
    expect(domain.signature.functionSymbols[0].inputSorts).toEqual([]);
    expect(domain.signature.functionSymbols[0].outputSort).toBe("Status");
  });

  it("handles simple 'A -> B' signature", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "simple", signature: "Input -> Output" }],
    });
    expect(domain.signature.functionSymbols[0].inputSorts).toEqual(["Input"]);
    expect(domain.signature.functionSymbols[0].outputSort).toBe("Output");
  });

  it("handles multi-input 'A x B x C -> D' signature", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "multi", signature: "A x B x C -> D" }],
    });
    expect(domain.signature.functionSymbols[0].inputSorts).toEqual(["A", "B", "C"]);
    expect(domain.signature.functionSymbols[0].outputSort).toBe("D");
  });

  it("strips Option() wrapper from output type", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "opt", signature: "A -> Option(Result)" }],
    });
    expect(domain.signature.functionSymbols[0].outputSort).toBe("Result");
  });

  it("does not strip Option when not a wrapper (no match)", () => {
    const domain = convertDomain({
      id: "D_SIG",
      function_symbols: [{ name: "noopt", signature: "A -> NotOption" }],
    });
    expect(domain.signature.functionSymbols[0].outputSort).toBe("NotOption");
  });
});

// ── convertDomain — edge cases for predicates and axioms ──

describe("convertDomain — predicate and axiom edge cases", () => {
  it("uses predicate name as fallback when description is absent", () => {
    const domain = convertDomain({
      id: "D_PRED",
      predicates: [{ name: "is_valid" }],
    });
    const pred = domain.signature.predicates["is_valid"];
    expect(pred.tag).toBe("check");
    if (pred.tag === "check") {
      expect(pred.label).toBe("is_valid");
    }
  });

  it("uses axiom name when id is absent", () => {
    const domain = convertDomain({
      id: "D_AX",
      axioms: [{ name: "soundness", statement: "forall x. P(x)" }],
    });
    expect(Object.keys(domain.axioms)).toEqual(["soundness"]);
    expect(evaluate(domain.axioms["soundness"], {})).toBe(true);
  });

  it("uses 'unnamed' when axiom has neither id nor name", () => {
    const domain = convertDomain({
      id: "D_AX",
      axioms: [{ statement: "some axiom" }],
    });
    expect(Object.keys(domain.axioms)).toEqual(["unnamed"]);
  });

  it("uses empty string when axiom has no statement", () => {
    const domain = convertDomain({
      id: "D_AX",
      axioms: [{ id: "Ax-empty" }],
    });
    // Empty statement → parsePredicate("") → TRUE
    expect(evaluate(domain.axioms["Ax-empty"], {})).toBe(true);
    expect(domain.axioms["Ax-empty"].tag).toBe("val");
  });

  it("defaults sort description to empty string when absent", () => {
    const domain = convertDomain({
      id: "D_SORT",
      sorts: [{ name: "Bare" }],
    });
    expect(domain.signature.sorts[0].description).toBe("");
  });
});

// ── convertDomain — function totality fallback ──

describe("convertDomain — function totality", () => {
  it("maps 'total' correctly", () => {
    const domain = convertDomain({
      id: "D_TOT",
      function_symbols: [{ name: "f", signature: "A -> B", totality: "total" }],
    });
    expect(domain.signature.functionSymbols[0].totality).toBe("total");
  });

  it("maps 'partial' correctly", () => {
    const domain = convertDomain({
      id: "D_TOT",
      function_symbols: [{ name: "f", signature: "A -> B", totality: "partial" }],
    });
    expect(domain.signature.functionSymbols[0].totality).toBe("partial");
  });

  it("defaults to 'total' for unknown totality value", () => {
    const domain = convertDomain({
      id: "D_TOT",
      function_symbols: [{ name: "f", signature: "A -> B", totality: "unknown_value" }],
    });
    expect(domain.signature.functionSymbols[0].totality).toBe("total");
  });

  it("defaults to 'total' when totality is undefined", () => {
    const domain = convertDomain({
      id: "D_TOT",
      function_symbols: [{ name: "f", signature: "A -> B" }],
    });
    expect(domain.signature.functionSymbols[0].totality).toBe("total");
  });
});
