/**
 * Commission module tests.
 *
 * Validates commission construction, batch rendering, template output,
 * bridge parameter threading, and metadata defaults.
 *
 * PRD 021 Components 9 + 12.
 */

import { describe, it, expect, vi } from "vitest";
import { Prompt, constant } from "../../prompt/prompt.js";
import {
  commission,
  batchCommission,
  type BridgeParams,
  type CommissionMetadata,
  type Commission,
} from "../commission.js";
import {
  templates,
  type ImplementationConfig,
  type ReviewConfig,
  type CouncilConfig,
  type RetroConfig,
} from "../templates.js";

// ── Fixtures ──

type TaskCtx = { readonly task: string; readonly priority: number };

const taskPrompt = new Prompt<TaskCtx>(
  (c) => `Execute task: ${c.task} (priority ${c.priority})`,
);

const baseBridge: BridgeParams = {
  workdir: "/repo",
};

const fullBridge: BridgeParams = {
  workdir: "/repo/packages/core",
  nickname: "impl-agent",
  purpose: "Implement feature X",
  parentSessionId: "parent-001",
  depth: 1,
  budget: { maxDepth: 3, maxAgents: 5 },
  isolation: "worktree",
  timeoutMs: 60_000,
  mode: "pty",
  spawnArgs: ["--model", "opus"],
};

const fixedDate = new Date("2026-03-21T12:00:00Z");

// ── commission() ──

describe("commission()", () => {
  it("renders prompt text from Prompt<A>", () => {
    const ctx: TaskCtx = { task: "build-sdk", priority: 1 };
    const result = commission(taskPrompt, ctx, baseBridge);

    expect(result.prompt).toBe("Execute task: build-sdk (priority 1)");
  });

  it("preserves context in the output", () => {
    const ctx: TaskCtx = { task: "test-suite", priority: 2 };
    const result = commission(taskPrompt, ctx, baseBridge);

    expect(result.context).toBe(ctx);
    expect(result.context.task).toBe("test-suite");
    expect(result.context.priority).toBe(2);
  });

  it("passes bridge params through unchanged", () => {
    const ctx: TaskCtx = { task: "deploy", priority: 3 };
    const result = commission(taskPrompt, ctx, fullBridge);

    expect(result.bridge).toBe(fullBridge);
    expect(result.bridge.workdir).toBe("/repo/packages/core");
    expect(result.bridge.nickname).toBe("impl-agent");
    expect(result.bridge.isolation).toBe("worktree");
  });

  it("defaults generatedAt to now when no metadata provided", () => {
    const before = new Date();
    const ctx: TaskCtx = { task: "check", priority: 0 };
    const result = commission(taskPrompt, ctx, baseBridge);
    const after = new Date();

    expect(result.metadata.generatedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(result.metadata.generatedAt.getTime()).toBeLessThanOrEqual(
      after.getTime(),
    );
  });

  it("uses provided generatedAt from metadata", () => {
    const ctx: TaskCtx = { task: "check", priority: 0 };
    const result = commission(taskPrompt, ctx, baseBridge, {
      generatedAt: fixedDate,
    });

    expect(result.metadata.generatedAt).toBe(fixedDate);
  });

  it("passes methodology traceability fields through metadata", () => {
    const ctx: TaskCtx = { task: "trace", priority: 1 };
    const result = commission(taskPrompt, ctx, baseBridge, {
      generatedAt: fixedDate,
      methodologyId: "P2-SD",
      methodId: "M3-IMPL",
      stepId: "s-code",
    });

    expect(result.metadata.methodologyId).toBe("P2-SD");
    expect(result.metadata.methodId).toBe("M3-IMPL");
    expect(result.metadata.stepId).toBe("s-code");
  });

  it("leaves optional metadata fields undefined when not provided", () => {
    const ctx: TaskCtx = { task: "minimal", priority: 0 };
    const result = commission(taskPrompt, ctx, baseBridge);

    expect(result.metadata.methodologyId).toBeUndefined();
    expect(result.metadata.methodId).toBeUndefined();
    expect(result.metadata.stepId).toBeUndefined();
  });
});

// ── batchCommission() ──

describe("batchCommission()", () => {
  const contexts: TaskCtx[] = [
    { task: "alpha", priority: 1 },
    { task: "beta", priority: 2 },
    { task: "gamma", priority: 3 },
  ];

  const bridgeFactory = (ctx: TaskCtx, i: number): BridgeParams => ({
    workdir: `/repo/work-${i}`,
    nickname: `agent-${ctx.task}`,
  });

  it("produces array of correct length", () => {
    const results = batchCommission(taskPrompt, contexts, bridgeFactory);
    expect(results).toHaveLength(3);
  });

  it("renders each prompt with its own context", () => {
    const results = batchCommission(taskPrompt, contexts, bridgeFactory);

    expect(results[0].prompt).toBe("Execute task: alpha (priority 1)");
    expect(results[1].prompt).toBe("Execute task: beta (priority 2)");
    expect(results[2].prompt).toBe("Execute task: gamma (priority 3)");
  });

  it("each commission has unique bridge params from factory", () => {
    const results = batchCommission(taskPrompt, contexts, bridgeFactory);

    expect(results[0].bridge.workdir).toBe("/repo/work-0");
    expect(results[0].bridge.nickname).toBe("agent-alpha");
    expect(results[1].bridge.workdir).toBe("/repo/work-1");
    expect(results[1].bridge.nickname).toBe("agent-beta");
    expect(results[2].bridge.workdir).toBe("/repo/work-2");
    expect(results[2].bridge.nickname).toBe("agent-gamma");
  });

  it("shares metadata across all commissions", () => {
    const results = batchCommission(taskPrompt, contexts, bridgeFactory, {
      generatedAt: fixedDate,
      methodologyId: "P2-SD",
    });

    for (const r of results) {
      expect(r.metadata.generatedAt).toBe(fixedDate);
      expect(r.metadata.methodologyId).toBe("P2-SD");
    }
  });

  it("returns empty array for empty contexts", () => {
    const results = batchCommission(taskPrompt, [], bridgeFactory);
    expect(results).toEqual([]);
  });
});

// ── BridgeParams construction ──

describe("BridgeParams", () => {
  it("constructs with only required workdir", () => {
    const params: BridgeParams = { workdir: "/tmp" };
    expect(params.workdir).toBe("/tmp");
    expect(params.nickname).toBeUndefined();
    expect(params.budget).toBeUndefined();
  });

  it("constructs with all optional fields", () => {
    expect(fullBridge.workdir).toBe("/repo/packages/core");
    expect(fullBridge.nickname).toBe("impl-agent");
    expect(fullBridge.purpose).toBe("Implement feature X");
    expect(fullBridge.parentSessionId).toBe("parent-001");
    expect(fullBridge.depth).toBe(1);
    expect(fullBridge.budget).toEqual({ maxDepth: 3, maxAgents: 5 });
    expect(fullBridge.isolation).toBe("worktree");
    expect(fullBridge.timeoutMs).toBe(60_000);
    expect(fullBridge.mode).toBe("pty");
    expect(fullBridge.spawnArgs).toEqual(["--model", "opus"]);
  });
});

// ── CommissionMetadata ──

describe("CommissionMetadata", () => {
  it("generatedAt defaults to now when commission() called without metadata", () => {
    const before = Date.now();
    const result = commission(
      constant("test"),
      {},
      baseBridge,
    );
    const after = Date.now();

    expect(result.metadata.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.metadata.generatedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

// ── templates.implementation ──

describe("templates.implementation", () => {
  const config: ImplementationConfig = {
    taskId: "WU-2.3",
    description: "Build commission module",
    scope: ["src/commission/commission.ts", "src/commission/templates.ts"],
    rules: ["No Effect dependency", "JSDoc on all exports"],
  };

  it("renders Role section with description", () => {
    const prompt = templates.implementation();
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("Build commission module");
  });

  it("renders Scope section with bullet list", () => {
    const prompt = templates.implementation();
    const text = prompt.run(config);

    expect(text).toContain("## Scope");
    expect(text).toContain("- src/commission/commission.ts");
    expect(text).toContain("- src/commission/templates.ts");
  });

  it("renders Constraints section with numbered rules", () => {
    const prompt = templates.implementation();
    const text = prompt.run(config);

    expect(text).toContain("## Constraints");
    expect(text).toContain("1. No Effect dependency");
    expect(text).toContain("2. JSDoc on all exports");
  });

  it("renders Git section with branch when provided", () => {
    const withBranch: ImplementationConfig = { ...config, branch: "feat/wu-2.3" };
    const prompt = templates.implementation();
    const text = prompt.run(withBranch);

    expect(text).toContain("## Git");
    expect(text).toContain("Branch: feat/wu-2.3");
  });

  it("renders Git section with default text when no branch", () => {
    const prompt = templates.implementation();
    const text = prompt.run(config);

    expect(text).toContain("Branch: create a new feature branch");
  });

  it("applies defaults from template function argument", () => {
    const prompt = templates.implementation({ branch: "main" });
    const configNoBranch: ImplementationConfig = {
      taskId: "T-1",
      description: "Test",
      scope: ["file.ts"],
      rules: ["rule1"],
    };
    const text = prompt.run(configNoBranch);

    expect(text).toContain("Branch: main");
  });
});

// ── templates.review ──

describe("templates.review", () => {
  const config: ReviewConfig = {
    target: "PR #42",
    criteria: ["Type safety", "Test coverage", "No breaking changes"],
  };

  it("renders Role section", () => {
    const prompt = templates.review();
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("review sub-agent");
  });

  it("renders target", () => {
    const prompt = templates.review();
    const text = prompt.run(config);

    expect(text).toContain("## Target");
    expect(text).toContain("Target: PR #42");
  });

  it("renders criteria as numbered list", () => {
    const prompt = templates.review();
    const text = prompt.run(config);

    expect(text).toContain("## Criteria");
    expect(text).toContain("1. Type safety");
    expect(text).toContain("2. Test coverage");
    expect(text).toContain("3. No breaking changes");
  });

  it("renders Advisors section when provided", () => {
    const withAdvisors: ReviewConfig = {
      ...config,
      advisors: ["security-expert", "perf-expert"],
    };
    const prompt = templates.review();
    const text = prompt.run(withAdvisors);

    expect(text).toContain("## Advisors");
    expect(text).toContain("- security-expert");
    expect(text).toContain("- perf-expert");
  });

  it("omits Advisors section when not provided", () => {
    const prompt = templates.review();
    const text = prompt.run(config);

    expect(text).not.toContain("## Advisors");
  });
});

// ── templates.council ──

describe("templates.council", () => {
  const config: CouncilConfig = {
    agenda: ["Review Q1 priorities", "Approve PRD 022"],
  };

  it("renders Role section", () => {
    const prompt = templates.council();
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("steering council");
  });

  it("renders agenda as numbered list", () => {
    const prompt = templates.council();
    const text = prompt.run(config);

    expect(text).toContain("## Agenda");
    expect(text).toContain("1. Review Q1 priorities");
    expect(text).toContain("2. Approve PRD 022");
  });

  it("renders Participants when provided", () => {
    const withParts: CouncilConfig = {
      ...config,
      participants: ["lead", "architect"],
    };
    const prompt = templates.council();
    const text = prompt.run(withParts);

    expect(text).toContain("## Participants");
    expect(text).toContain("- lead");
    expect(text).toContain("- architect");
  });

  it("omits Participants when not provided", () => {
    const prompt = templates.council();
    const text = prompt.run(config);

    expect(text).not.toContain("## Participants");
  });

  it("renders Project Card section when provided", () => {
    const withCard: CouncilConfig = {
      ...config,
      projectCard: "essence: purpose is runtime",
    };
    const prompt = templates.council();
    const text = prompt.run(withCard);

    expect(text).toContain("## Project Card");
    expect(text).toContain("essence: purpose is runtime");
  });
});

// ── templates.retro ──

describe("templates.retro", () => {
  const config: RetroConfig = {
    sessionId: "sess-042",
    trace: "Step 1: loaded YAML. Step 2: ran tests. Step 3: committed.",
  };

  it("renders Role section", () => {
    const prompt = templates.retro();
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("retrospective agent");
  });

  it("renders sessionId", () => {
    const prompt = templates.retro();
    const text = prompt.run(config);

    expect(text).toContain("## Session");
    expect(text).toContain("Session ID: sess-042");
  });

  it("renders trace content", () => {
    const prompt = templates.retro();
    const text = prompt.run(config);

    expect(text).toContain("## Trace");
    expect(text).toContain("Step 1: loaded YAML");
  });

  it("renders Focus section when provided", () => {
    const withFocus: RetroConfig = {
      ...config,
      focus: "test coverage gaps",
    };
    const prompt = templates.retro();
    const text = prompt.run(withFocus);

    expect(text).toContain("## Focus");
    expect(text).toContain("Focus area: test coverage gaps");
  });

  it("omits Focus section when not provided", () => {
    const prompt = templates.retro();
    const text = prompt.run(config);

    expect(text).not.toContain("## Focus");
  });
});
