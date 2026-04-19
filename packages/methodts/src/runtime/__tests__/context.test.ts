// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the Step Context Protocol: assembleContext, InsightStore, renderDomainFacts.
 *
 * Covers all 4 channels: world reads, insight store, domain facts, sufficiency.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { createInsightStore, type InsightStore } from "../insight-store.js";
import { renderDomainFacts } from "../domain-facts.js";
import { assembleContext, type ContextError } from "../context.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import type { ContextSpec, DomainFactsSpec } from "../../method/step.js";
import { check, TRUE, FALSE } from "../../predicate/predicate.js";

// ── Test fixtures ──

type TestState = { count: number; phase: string };

const testDomain: DomainTheory<TestState> = {
  id: "D-TEST",
  signature: {
    sorts: [
      { name: "Phase", description: "Delivery phase", cardinality: "finite" },
      { name: "Artifact", description: "Produced artifact", cardinality: "unbounded" },
      { name: "Config", description: "Singleton config", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "advance", inputSorts: ["Phase"], outputSort: "Phase", totality: "partial" },
    ],
    predicates: {
      "is-ready": check<TestState>("is-ready", (s) => s.count > 0),
      "is-complete": check<TestState>("is-complete", (s) => s.phase === "done"),
      "has-artifacts": check<TestState>("has-artifacts", (s) => s.count >= 3),
    },
  },
  axioms: {
    "AX-POSITIVE": check<TestState>("count >= 0", (s) => s.count >= 0),
    "AX-PHASE-SET": check<TestState>("phase non-empty", (s) => s.phase.length > 0),
  },
};

const testRole: Role<TestState, TestState> = {
  id: "R-ENGINEER",
  description: "Implementation engineer",
  observe: (s) => s,
  authorized: ["step-design", "step-implement"],
  notAuthorized: ["step-approve"],
};

// ── InsightStore ──

describe("InsightStore", () => {
  it("create -> set -> get returns value", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        yield* store.set("design-decision", "Use event sourcing");
        return yield* store.get("design-decision");
      }),
    );
    expect(result).toBe("Use event sourcing");
  });

  it("has returns true for existing keys", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ existing: "value" });
        return yield* store.has("existing");
      }),
    );
    expect(result).toBe(true);
  });

  it("has returns false for missing keys", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* store.has("nonexistent");
      }),
    );
    expect(result).toBe(false);
  });

  it("getAll returns all entries", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        yield* store.set("key1", "value1");
        yield* store.set("key2", "value2");
        yield* store.set("key3", "value3");
        return yield* store.getAll();
      }),
    );
    expect(result).toEqual({
      key1: "value1",
      key2: "value2",
      key3: "value3",
    });
  });

  it("get returns undefined for missing keys", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* store.get("missing");
      }),
    );
    expect(result).toBeUndefined();
  });

  it("set overwrites existing values", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ key: "old" });
        yield* store.set("key", "new");
        return yield* store.get("key");
      }),
    );
    expect(result).toBe("new");
  });

  it("initializes with provided entries", async () => {
    const initial = { a: "alpha", b: "beta" };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore(initial);
        return yield* store.getAll();
      }),
    );
    expect(result).toEqual(initial);
  });
});

// ── renderDomainFacts ──

describe("renderDomainFacts", () => {
  it('"all" axioms -> lists all axiom names', () => {
    const result = renderDomainFacts(
      { axioms: "all" },
      testDomain,
    );
    expect(result).toContain("## Domain Axioms");
    expect(result).toContain("Invariant: AX-POSITIVE");
    expect(result).toContain("Invariant: AX-PHASE-SET");
  });

  it("specific axiom names -> lists only those", () => {
    const result = renderDomainFacts(
      { axioms: ["AX-POSITIVE"] },
      testDomain,
    );
    expect(result).toContain("Invariant: AX-POSITIVE");
    expect(result).not.toContain("AX-PHASE-SET");
  });

  it('"all" predicates -> lists all predicate names', () => {
    const result = renderDomainFacts(
      { predicates: "all" },
      testDomain,
    );
    expect(result).toContain("## Domain Predicates");
    expect(result).toContain("Predicate: is-ready");
    expect(result).toContain("Predicate: is-complete");
    expect(result).toContain("Predicate: has-artifacts");
  });

  it("specific predicate names -> lists only those", () => {
    const result = renderDomainFacts(
      { predicates: ["is-ready"] },
      testDomain,
    );
    expect(result).toContain("Predicate: is-ready");
    expect(result).not.toContain("is-complete");
  });

  it("sorts with descriptions", () => {
    const result = renderDomainFacts(
      { sorts: "all" },
      testDomain,
    );
    expect(result).toContain("## Domain Sorts");
    expect(result).toContain("Phase: Delivery phase (finite)");
    expect(result).toContain("Artifact: Produced artifact (unbounded)");
    expect(result).toContain("Config: Singleton config (singleton)");
  });

  it("specific sort names -> lists only those", () => {
    const result = renderDomainFacts(
      { sorts: ["Phase", "Config"] },
      testDomain,
    );
    expect(result).toContain("Phase: Delivery phase (finite)");
    expect(result).toContain("Config: Singleton config (singleton)");
    expect(result).not.toContain("Artifact");
  });

  it("role constraints rendered", () => {
    const result = renderDomainFacts(
      { roleConstraints: true },
      testDomain,
      testRole,
    );
    expect(result).toContain("## Role: R-ENGINEER");
    expect(result).toContain("Implementation engineer");
    expect(result).toContain("Authorized: step-design, step-implement");
    expect(result).toContain("Not authorized: step-approve");
  });

  it("roleConstraints without role -> no section", () => {
    const result = renderDomainFacts(
      { roleConstraints: true },
      testDomain,
    );
    expect(result).toBe("");
  });

  it("empty spec -> empty string", () => {
    const result = renderDomainFacts({}, testDomain);
    expect(result).toBe("");
  });

  it("multiple sections combined with double newline", () => {
    const result = renderDomainFacts(
      { axioms: "all", sorts: "all" },
      testDomain,
    );
    expect(result).toContain("## Domain Axioms");
    expect(result).toContain("## Domain Sorts");
    // Sections separated by double newline
    expect(result).toContain("\n\n## Domain Sorts");
  });
});

// ── assembleContext ──

describe("assembleContext", () => {
  const state: TestState = { count: 5, phase: "implement" };

  it("all 4 channels populated -> correct StepContext", async () => {
    const spec: ContextSpec<TestState> = {
      insightDeps: ["design-decision", "architecture"],
      domainFacts: { axioms: "all", sorts: "all", roleConstraints: true },
      sufficient: TRUE,
    };

    const worldFragments = { "file:readme": "# README content", "cmd:status": "clean" };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({
          "design-decision": "Use event sourcing",
          "architecture": "Hexagonal",
          "unrelated": "Should not appear",
        });
        return yield* assembleContext(spec, state, worldFragments, store, testDomain, testRole);
      }),
    );

    // Channel 1: World
    expect(result.world).toEqual({ "file:readme": "# README content", "cmd:status": "clean" });

    // Channel 2: Insights (only requested deps)
    expect(result.insights).toEqual({
      "design-decision": "Use event sourcing",
      "architecture": "Hexagonal",
    });
    expect(result.insights).not.toHaveProperty("unrelated");

    // Channel 3: Domain facts
    expect(result.domainFacts).toContain("## Domain Axioms");
    expect(result.domainFacts).toContain("## Domain Sorts");
    expect(result.domainFacts).toContain("## Role: R-ENGINEER");

    // State passed through
    expect(result.state).toBe(state);
  });

  it("empty channels -> StepContext with empty records", async () => {
    const spec: ContextSpec<TestState> = {};

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );

    expect(result.world).toEqual({});
    expect(result.insights).toEqual({});
    expect(result.domainFacts).toBe("");
    expect(result.state).toBe(state);
  });

  it("insight deps with missing keys -> only available insights returned", async () => {
    const spec: ContextSpec<TestState> = {
      insightDeps: ["exists", "missing"],
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ exists: "here" });
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );

    expect(result.insights).toEqual({ exists: "here" });
    expect(result.insights).not.toHaveProperty("missing");
  });

  it("no insightDeps -> empty insights", async () => {
    const spec: ContextSpec<TestState> = {};

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ some: "insight" });
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );

    expect(result.insights).toEqual({});
  });

  it("no domainFacts spec -> empty domainFacts string", async () => {
    const spec: ContextSpec<TestState> = {};

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );

    expect(result.domainFacts).toBe("");
  });

  it("worldFragments passed through unchanged", async () => {
    const fragments = { "git:diff": "+++file.ts", "fs:config": "{}" };
    const spec: ContextSpec<TestState> = {};

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, fragments, store, testDomain);
      }),
    );

    expect(result.world).toEqual(fragments);
  });
});

// ── Sufficiency check ──

describe("Context sufficiency", () => {
  const state: TestState = { count: 5, phase: "implement" };

  it("passing predicate -> success", async () => {
    const spec: ContextSpec<TestState> = {
      sufficient: TRUE,
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );

    expect(result.state).toBe(state);
  });

  it("failing predicate -> ContextError", async () => {
    const spec: ContextSpec<TestState> = {
      sufficient: FALSE,
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, {}, store, testDomain).pipe(
          Effect.flip,
        );
      }),
    );

    expect(result._tag).toBe("ContextError");
    expect(result.message).toContain("sufficiency check");
  });

  it("custom predicate that checks context fields", async () => {
    const spec: ContextSpec<TestState> = {
      insightDeps: ["required-insight"],
      sufficient: check("has-required-insight", (ctx) =>
        "required-insight" in ctx.insights,
      ),
    };

    // With the insight present -> success
    const successResult = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ "required-insight": "present" });
        return yield* assembleContext(spec, state, {}, store, testDomain);
      }),
    );
    expect(successResult.insights["required-insight"]).toBe("present");

    // Without the insight -> ContextError
    const failResult = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        return yield* assembleContext(spec, state, {}, store, testDomain).pipe(
          Effect.flip,
        );
      }),
    );
    expect(failResult._tag).toBe("ContextError");
  });

  it("sufficiency check receives fully assembled context", async () => {
    let capturedCtx: any = null;
    const spec: ContextSpec<TestState> = {
      insightDeps: ["key1"],
      domainFacts: { axioms: "all" },
      sufficient: check("capture-context", (ctx) => {
        capturedCtx = ctx;
        return true;
      }),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore({ key1: "val1" });
        return yield* assembleContext(
          spec,
          state,
          { world1: "data" },
          store,
          testDomain,
        );
      }),
    );

    // Verify the sufficiency predicate received all channels populated
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.state).toBe(state);
    expect(capturedCtx.world).toEqual({ world1: "data" });
    expect(capturedCtx.insights).toEqual({ key1: "val1" });
    expect(capturedCtx.domainFacts).toContain("## Domain Axioms");
  });
});
