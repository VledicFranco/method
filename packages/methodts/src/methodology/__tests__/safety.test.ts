// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for checkSafety — runtime safety bounds checking.
 *
 * F1-FTH: SafetyBounds are pragmatic runtime limits, not the termination certificate.
 */

import { describe, it, expect } from "vitest";
import { checkSafety, type ExecutionAccumulator } from "../safety.js";
import type { SafetyBounds } from "../methodology.js";

const bounds: SafetyBounds = {
  maxLoops: 10,
  maxTokens: 100_000,
  maxCostUsd: 25,
  maxDurationMs: 600_000,
  maxDepth: 5,
};

function makeAcc(overrides: Partial<ExecutionAccumulator> = {}): ExecutionAccumulator {
  return {
    loopCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    startedAt: new Date(),
    elapsedMs: 0,
    suspensionCount: 0,
    ...overrides,
  };
}

describe("checkSafety", () => {
  it("returns safe when all bounds are OK", () => {
    const result = checkSafety(bounds, makeAcc({ loopCount: 5, totalTokens: 50_000, totalCostUsd: 10, elapsedMs: 300_000 }));
    expect(result.safe).toBe(true);
    expect(result.violation).toBeUndefined();
  });

  it("reports maxLoops violation when loop count reaches the limit", () => {
    const result = checkSafety(bounds, makeAcc({ loopCount: 10 }));
    expect(result.safe).toBe(false);
    expect(result.violation).toEqual({ bound: "maxLoops", limit: 10, actual: 10 });
  });

  it("reports maxTokens violation when token count reaches the limit", () => {
    const result = checkSafety(bounds, makeAcc({ totalTokens: 100_000 }));
    expect(result.safe).toBe(false);
    expect(result.violation).toEqual({ bound: "maxTokens", limit: 100_000, actual: 100_000 });
  });

  it("reports maxCostUsd violation when cost reaches the limit", () => {
    const result = checkSafety(bounds, makeAcc({ totalCostUsd: 25 }));
    expect(result.safe).toBe(false);
    expect(result.violation).toEqual({ bound: "maxCostUsd", limit: 25, actual: 25 });
  });

  it("reports maxDurationMs violation when elapsed time reaches the limit", () => {
    const result = checkSafety(bounds, makeAcc({ elapsedMs: 600_000 }));
    expect(result.safe).toBe(false);
    expect(result.violation).toEqual({ bound: "maxDurationMs", limit: 600_000, actual: 600_000 });
  });
});
