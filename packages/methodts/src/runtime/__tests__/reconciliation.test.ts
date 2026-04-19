// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for reconciliation.ts — parsed vs observed state diffing.
 *
 * Covers: reconcile (pure), reconcileWithExtractor (Effect-based),
 * divergence detection, ignoredFields filtering, and extraction failure.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  reconcile,
  reconcileWithExtractor,
  type ReconciliationConfig,
} from "../reconciliation.js";

type TestState = Record<string, unknown>;

describe("reconcile", () => {
  it("matching states produce status 'match' with no divergences", () => {
    const state: TestState = { branch: "main", fileCount: 10 };
    const result = reconcile(state, state);

    expect(result.status).toBe("match");
    expect(result.divergences).toEqual([]);
    expect(result.diff).toBeNull();
    expect(result.parsedState).toBe(state);
    expect(result.observedState).toBe(state);
  });

  it("detects 'missing_from_agent' when observed has fields parsed lacks", () => {
    // diff(parsed, observed).added = keys in observed not in parsed
    // Agent didn't report these fields → missing_from_agent
    const parsed: TestState = { branch: "main" };
    const observed: TestState = { branch: "main", newFile: "readme.md" };
    const result = reconcile(parsed, observed);

    expect(result.status).toBe("diverged");
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toEqual({
      field: "newFile",
      type: "missing_from_agent",
      parsedValue: undefined,
      observedValue: "readme.md",
    });
    expect(result.diff).not.toBeNull();
  });

  it("detects 'added_by_agent' when parsed has fields observed lacks", () => {
    // diff(parsed, observed).removed = keys in parsed not in observed
    // Agent claimed these but they don't exist in reality → added_by_agent
    const parsed: TestState = { branch: "main", extra: "gone" };
    const observed: TestState = { branch: "main" };
    const result = reconcile(parsed, observed);

    expect(result.status).toBe("diverged");
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toEqual({
      field: "extra",
      type: "added_by_agent",
      parsedValue: "gone",
      observedValue: undefined,
    });
  });

  it("detects 'value_mismatch' when fields differ", () => {
    const parsed: TestState = { branch: "main", count: 5 };
    const observed: TestState = { branch: "develop", count: 5 };
    const result = reconcile(parsed, observed);

    expect(result.status).toBe("diverged");
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toEqual({
      field: "branch",
      type: "value_mismatch",
      parsedValue: "main",
      observedValue: "develop",
    });
  });

  it("reports multiple divergences when several fields differ", () => {
    const parsed: TestState = { a: 1, b: 2, c: 3 };
    const observed: TestState = { a: 1, b: 99, d: 4 };
    const result = reconcile(parsed, observed);

    expect(result.status).toBe("diverged");
    // b changed (value_mismatch), c in parsed not observed (added_by_agent), d in observed not parsed (missing_from_agent)
    expect(result.divergences).toHaveLength(3);

    const types = result.divergences.map((d) => d.type);
    expect(types).toContain("value_mismatch");
    expect(types).toContain("added_by_agent");
    expect(types).toContain("missing_from_agent");

    const byField = Object.fromEntries(
      result.divergences.map((d) => [d.field, d]),
    );
    expect(byField["b"].type).toBe("value_mismatch");
    expect(byField["b"].parsedValue).toBe(2);
    expect(byField["b"].observedValue).toBe(99);
    expect(byField["c"].type).toBe("added_by_agent");
    expect(byField["d"].type).toBe("missing_from_agent");
  });

  it("ignoredFields filter excludes specified fields from divergences", () => {
    const parsed: TestState = { a: 1, b: 2, c: 3 };
    const observed: TestState = { a: 1, b: 99, d: 4 };
    const config: ReconciliationConfig = {
      mode: "warn",
      ignoredFields: ["b", "c", "d"],
    };
    const result = reconcile(parsed, observed, config);

    expect(result.status).toBe("match");
    expect(result.divergences).toEqual([]);
    expect(result.diff).toBeNull();
  });

  it("partially ignored fields still report unignored divergences", () => {
    const parsed: TestState = { a: 1, b: 2, c: 3 };
    const observed: TestState = { a: 1, b: 99, d: 4 };
    const config: ReconciliationConfig = {
      mode: "warn",
      ignoredFields: ["b"],
    };
    const result = reconcile(parsed, observed, config);

    expect(result.status).toBe("diverged");
    // c removed (missing_from_agent) + d added (added_by_agent), b is ignored
    expect(result.divergences).toHaveLength(2);
    const fields = result.divergences.map((d) => d.field);
    expect(fields).not.toContain("b");
    expect(fields).toContain("c");
    expect(fields).toContain("d");
  });

  it("empty states produce a match", () => {
    const result = reconcile({}, {});

    expect(result.status).toBe("match");
    expect(result.divergences).toEqual([]);
    expect(result.diff).toBeNull();
  });

  it("preserves config mode without enforcing it", () => {
    // The reconcile function stores mode in config but doesn't enforce behavior
    // (enforcement is the caller's responsibility)
    const parsed: TestState = { a: 1 };
    const observed: TestState = { a: 2 };

    for (const mode of ["warn", "fail", "ignore"] as const) {
      const config: ReconciliationConfig = { mode };
      const result = reconcile(parsed, observed, config);
      // All modes still report the divergence — enforcement is external
      expect(result.status).toBe("diverged");
      expect(result.divergences).toHaveLength(1);
    }
  });

  it("includes diff when divergences exist", () => {
    const parsed: TestState = { a: 1 };
    const observed: TestState = { a: 2 };
    const result = reconcile(parsed, observed);

    expect(result.diff).not.toBeNull();
    expect(result.diff!.changed).toHaveProperty("a");
    expect(result.diff!.changed["a"]).toEqual({ before: 1, after: 2 });
  });
});

describe("reconcileWithExtractor", () => {
  it("runs extractor and reconciles on success", async () => {
    const parsed: TestState = { branch: "main", count: 5 };
    const observed: TestState = { branch: "main", count: 5 };
    const extractor = Effect.succeed(observed);

    const result = await Effect.runPromise(
      reconcileWithExtractor(parsed, extractor),
    );

    expect(result.status).toBe("match");
    expect(result.parsedState).toBe(parsed);
    expect(result.observedState).toEqual(observed);
    expect(result.divergences).toEqual([]);
  });

  it("returns extraction_failed when extractor fails", async () => {
    const parsed: TestState = { branch: "main" };
    const extractor = Effect.fail(new Error("git unavailable"));

    const result = await Effect.runPromise(
      reconcileWithExtractor(parsed, extractor),
    );

    expect(result.status).toBe("extraction_failed");
    expect(result.parsedState).toBe(parsed);
    expect(result.observedState).toBeNull();
    expect(result.diff).toBeNull();
    expect(result.divergences).toEqual([]);
  });

  it("detects divergences through extractor path", async () => {
    const parsed: TestState = { branch: "main", count: 5 };
    const observed: TestState = { branch: "develop", count: 5 };
    const extractor = Effect.succeed(observed);

    const result = await Effect.runPromise(
      reconcileWithExtractor(parsed, extractor),
    );

    expect(result.status).toBe("diverged");
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].type).toBe("value_mismatch");
    expect(result.divergences[0].field).toBe("branch");
  });

  it("passes config through to reconcile", async () => {
    const parsed: TestState = { a: 1, b: 2 };
    const observed: TestState = { a: 1, b: 99 };
    const extractor = Effect.succeed(observed);
    const config: ReconciliationConfig = {
      mode: "warn",
      ignoredFields: ["b"],
    };

    const result = await Effect.runPromise(
      reconcileWithExtractor(parsed, extractor, config),
    );

    expect(result.status).toBe("match");
    expect(result.divergences).toEqual([]);
  });

  it("catches any error type from extractor", async () => {
    const parsed: TestState = { a: 1 };
    const extractor = Effect.fail("string error");

    const result = await Effect.runPromise(
      reconcileWithExtractor(parsed, extractor),
    );

    expect(result.status).toBe("extraction_failed");
  });
});
