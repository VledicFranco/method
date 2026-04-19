// SPDX-License-Identifier: Apache-2.0
/**
 * dag-gates-human-approval.test.ts
 *
 * Tests for the HumanApprovalResolver integration in dag-gates.ts (PRD-044).
 * Covers:
 * - Resolver called with correct context when a human_approval gate fires
 * - approved=true  → passed=true
 * - approved=false → passed=false with feedback
 * - null resolver  → backward-compat (passed:false, no error)
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateGate } from "../dag-gates.js";
import type {
  DagGateConfig,
  DagGateContext,
  HumanApprovalContext,
  HumanApprovalDecision,
  HumanApprovalResolver,
} from "../dag-types.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeGate(overrides: Partial<DagGateConfig> = {}): DagGateConfig {
  return {
    type: "human_approval",
    check: "true",
    max_retries: 0,
    timeout_ms: 30000,
    ...overrides,
  };
}

function makeContext(): DagGateContext {
  return {
    output: {},
    artifacts: {},
    execution_metadata: {
      num_turns: 1,
      cost_usd: 0.1,
      tool_call_count: 0,
      duration_ms: 200,
    },
  };
}

function makeApprovalContext(overrides: Partial<HumanApprovalContext> = {}): HumanApprovalContext {
  return {
    strategy_id: "S-TEST",
    execution_id: "exec-001",
    gate_id: "node-a:gate[0]",
    node_id: "node-a",
    timeout_ms: 30000,
    ...overrides,
  };
}

function makeResolver(decision: HumanApprovalDecision): HumanApprovalResolver {
  return {
    requestApproval: vi.fn().mockResolvedValue(decision),
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("dag-gates: HumanApprovalResolver integration", () => {
  it("calls resolver.requestApproval with the correct context", async () => {
    const gate = makeGate();
    const ctx = makeContext();
    const approvalCtx = makeApprovalContext({
      strategy_id: "S-REVIEW",
      execution_id: "exec-42",
      gate_id: "review:gate[0]",
      node_id: "review",
      artifact_markdown: "# PRD Content",
      artifact_type: "prd",
      timeout_ms: 60000,
    });
    const resolver = makeResolver({ approved: true });

    await evaluateGate(gate, "review:gate[0]", ctx, resolver, approvalCtx);

    expect(resolver.requestApproval).toHaveBeenCalledOnce();
    const calledWith = (resolver.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith.strategy_id).toBe("S-REVIEW");
    expect(calledWith.execution_id).toBe("exec-42");
    expect(calledWith.gate_id).toBe("review:gate[0]");
    expect(calledWith.node_id).toBe("review");
    expect(calledWith.artifact_markdown).toBe("# PRD Content");
    expect(calledWith.artifact_type).toBe("prd");
    expect(calledWith.timeout_ms).toBe(60000);
  });

  it("returns passed:true when resolver approves", async () => {
    const gate = makeGate();
    const ctx = makeContext();
    const approvalCtx = makeApprovalContext();
    const resolver = makeResolver({ approved: true });

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(true);
    expect(result.type).toBe("human_approval");
    expect(result.gate_id).toBe("node-a:gate[0]");
    expect(result.reason).toBe("Human approved");
    expect(result.feedback).toBeUndefined();
  });

  it("returns passed:false with feedback when resolver rejects", async () => {
    const gate = makeGate();
    const ctx = makeContext();
    const approvalCtx = makeApprovalContext();
    const resolver = makeResolver({
      approved: false,
      feedback: "The plan has a critical flaw in section 3",
    });

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(false);
    expect(result.type).toBe("human_approval");
    expect(result.reason).toBe("Human rejected");
    expect(result.feedback).toBe("The plan has a critical flaw in section 3");
  });

  it("returns passed:false with no feedback when resolver rejects without feedback", async () => {
    const gate = makeGate();
    const ctx = makeContext();
    const approvalCtx = makeApprovalContext();
    const resolver = makeResolver({ approved: false });

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(false);
    expect(result.feedback).toBeUndefined();
  });

  it("returns passed:false (backward compat) when resolver is null", async () => {
    const gate = makeGate();
    const ctx = makeContext();

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx, null);

    expect(result.passed).toBe(false);
    expect(result.type).toBe("human_approval");
    expect(result.reason).toBe("Awaiting human approval");
    expect(result.feedback).toContain("human approval required");
  });

  it("returns passed:false (backward compat) when resolver is undefined", async () => {
    const gate = makeGate();
    const ctx = makeContext();

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx);

    expect(result.passed).toBe(false);
    expect(result.type).toBe("human_approval");
    expect(result.reason).toBe("Awaiting human approval");
  });

  it("times out when resolver takes too long (F-L-2)", async () => {
    const gate = makeGate({ timeout_ms: 100 }); // Very short timeout for test
    const ctx = makeContext();
    const approvalCtx = makeApprovalContext({ timeout_ms: 100 });

    // Create a resolver that never resolves (simulates a hung human approval)
    const resolver: HumanApprovalResolver = {
      requestApproval: vi.fn().mockReturnValue(
        new Promise<HumanApprovalDecision>(() => {
          // Never resolves
        }),
      ),
    };

    const result = await evaluateGate(gate, "node-a:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(false);
    expect(result.type).toBe("human_approval");
    expect(result.reason).toContain("rejected");
    expect(result.feedback).toContain("timed out");
  });

  it("does not call resolver for algorithmic gates", async () => {
    const gate: DagGateConfig = {
      type: "algorithmic",
      check: "output.done === true",
      max_retries: 0,
      timeout_ms: 5000,
    };
    const ctx: DagGateContext = {
      output: { done: true },
      artifacts: {},
      execution_metadata: { num_turns: 1, cost_usd: 0, tool_call_count: 0, duration_ms: 50 },
    };
    const resolver = makeResolver({ approved: true });
    const approvalCtx = makeApprovalContext();

    const result = await evaluateGate(gate, "node-b:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(true);
    expect(resolver.requestApproval).not.toHaveBeenCalled();
  });

  it("does not call resolver for observation gates", async () => {
    const gate: DagGateConfig = {
      type: "observation",
      check: "execution_metadata.num_turns < 10",
      max_retries: 0,
      timeout_ms: 5000,
    };
    const ctx: DagGateContext = {
      output: {},
      artifacts: {},
      execution_metadata: { num_turns: 3, cost_usd: 0, tool_call_count: 0, duration_ms: 50 },
    };
    const resolver = makeResolver({ approved: true });
    const approvalCtx = makeApprovalContext();

    const result = await evaluateGate(gate, "node-c:gate[0]", ctx, resolver, approvalCtx);

    expect(result.passed).toBe(true);
    expect(resolver.requestApproval).not.toHaveBeenCalled();
  });
});
