/**
 * Commission module tests.
 *
 * Validates commission construction, batch rendering, template output,
 * bridge parameter threading, and metadata defaults.
 *
 * PRD 021 Components 9 + 12.
 */

import { describe, it, expect } from "vitest";
import { Prompt, constant } from "../../prompt/prompt.js";
import {
  commission,
  batchCommission,
  type BridgeParams,
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

// ── Template defaults paths (branch coverage) ──

describe("templates.review — defaults", () => {
  it("renders Advisors from defaults when config has no advisors", () => {
    const prompt = templates.review({ advisors: ["default-advisor"] });
    const config: ReviewConfig = {
      target: "PR #99",
      criteria: ["correctness"],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Advisors");
    expect(text).toContain("- default-advisor");
  });

  it("config advisors override defaults", () => {
    const prompt = templates.review({ advisors: ["default-advisor"] });
    const config: ReviewConfig = {
      target: "PR #99",
      criteria: ["correctness"],
      advisors: ["config-advisor"],
    };
    const text = prompt.run(config);

    expect(text).toContain("- config-advisor");
    expect(text).not.toContain("- default-advisor");
  });

  it("omits Advisors when neither config nor defaults provide them", () => {
    const prompt = templates.review();
    const config: ReviewConfig = {
      target: "PR #100",
      criteria: ["perf"],
    };
    const text = prompt.run(config);

    expect(text).not.toContain("## Advisors");
  });

  it("omits Advisors when defaults has empty array", () => {
    const prompt = templates.review({ advisors: [] });
    const config: ReviewConfig = {
      target: "PR #101",
      criteria: ["style"],
    };
    const text = prompt.run(config);

    expect(text).not.toContain("## Advisors");
  });

  it("renders with empty criteria array", () => {
    const prompt = templates.review();
    const config: ReviewConfig = {
      target: "PR #102",
      criteria: [],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("## Target");
    expect(text).toContain("Target: PR #102");
    // Criteria section should be empty (no numbered items)
    expect(text).not.toContain("1.");
  });
});

describe("templates.council — defaults", () => {
  it("renders Participants from defaults when config has none", () => {
    const prompt = templates.council({ participants: ["default-lead"] });
    const config: CouncilConfig = {
      agenda: ["item 1"],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Participants");
    expect(text).toContain("- default-lead");
  });

  it("config participants override defaults", () => {
    const prompt = templates.council({ participants: ["default-lead"] });
    const config: CouncilConfig = {
      agenda: ["item 1"],
      participants: ["config-lead"],
    };
    const text = prompt.run(config);

    expect(text).toContain("- config-lead");
    expect(text).not.toContain("- default-lead");
  });

  it("renders Project Card from defaults when config has none", () => {
    const prompt = templates.council({ projectCard: "default card content" });
    const config: CouncilConfig = {
      agenda: ["item 1"],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Project Card");
    expect(text).toContain("default card content");
  });

  it("config projectCard overrides defaults", () => {
    const prompt = templates.council({ projectCard: "default card" });
    const config: CouncilConfig = {
      agenda: ["item 1"],
      projectCard: "config card",
    };
    const text = prompt.run(config);

    expect(text).toContain("config card");
    expect(text).not.toContain("default card");
  });

  it("omits Project Card when neither config nor defaults provide it", () => {
    const prompt = templates.council();
    const config: CouncilConfig = {
      agenda: ["item 1"],
    };
    const text = prompt.run(config);

    expect(text).not.toContain("## Project Card");
  });

  it("omits Participants when defaults has empty array", () => {
    const prompt = templates.council({ participants: [] });
    const config: CouncilConfig = {
      agenda: ["item 1"],
    };
    const text = prompt.run(config);

    expect(text).not.toContain("## Participants");
  });

  it("renders with empty agenda array", () => {
    const prompt = templates.council();
    const config: CouncilConfig = {
      agenda: [],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("steering council");
    // Agenda section body should be empty (no numbered items)
    expect(text).not.toContain("1.");
  });
});

describe("templates.retro — defaults", () => {
  it("renders Focus from defaults when config has none", () => {
    const prompt = templates.retro({ focus: "default-focus-area" });
    const config: RetroConfig = {
      sessionId: "sess-100",
      trace: "did things",
    };
    const text = prompt.run(config);

    expect(text).toContain("## Focus");
    expect(text).toContain("Focus area: default-focus-area");
  });

  it("config focus overrides defaults", () => {
    const prompt = templates.retro({ focus: "default-focus" });
    const config: RetroConfig = {
      sessionId: "sess-101",
      trace: "did things",
      focus: "config-focus",
    };
    const text = prompt.run(config);

    expect(text).toContain("Focus area: config-focus");
    expect(text).not.toContain("default-focus");
  });

  it("omits Focus when neither config nor defaults provide it", () => {
    const prompt = templates.retro();
    const config: RetroConfig = {
      sessionId: "sess-102",
      trace: "trace content",
    };
    const text = prompt.run(config);

    expect(text).not.toContain("## Focus");
  });

  it("renders with empty trace string", () => {
    const prompt = templates.retro();
    const config: RetroConfig = {
      sessionId: "sess-103",
      trace: "",
    };
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("## Session");
    expect(text).toContain("Session ID: sess-103");
    // Trace section body is empty, so section should be omitted
  });
});

// ── Implementation template edge cases ──

describe("templates.implementation — edge cases", () => {
  it("renders with empty scope array", () => {
    const prompt = templates.implementation();
    const config: ImplementationConfig = {
      taskId: "T-empty-scope",
      description: "No scope files",
      scope: [],
      rules: ["rule1"],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("No scope files");
    expect(text).toContain("## Constraints");
    expect(text).toContain("1. rule1");
    // Scope section body is empty bullet list
  });

  it("renders with empty rules array", () => {
    const prompt = templates.implementation();
    const config: ImplementationConfig = {
      taskId: "T-empty-rules",
      description: "No rules",
      scope: ["file.ts"],
      rules: [],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Scope");
    expect(text).toContain("- file.ts");
    // Constraints section body is empty numbered list
  });

  it("renders with both empty scope and rules", () => {
    const prompt = templates.implementation();
    const config: ImplementationConfig = {
      taskId: "T-both-empty",
      description: "Minimal task",
      scope: [],
      rules: [],
    };
    const text = prompt.run(config);

    expect(text).toContain("## Role");
    expect(text).toContain("Minimal task");
    expect(text).toContain("## Git");
  });

  it("config branch takes priority over defaults branch", () => {
    const prompt = templates.implementation({ branch: "default-branch" });
    const config: ImplementationConfig = {
      taskId: "T-branch",
      description: "Branch test",
      scope: ["a.ts"],
      rules: [],
      branch: "config-branch",
    };
    const text = prompt.run(config);

    expect(text).toContain("Branch: config-branch");
    expect(text).not.toContain("default-branch");
  });
});

// ── batchCommission edge cases ──

describe("batchCommission() — edge cases", () => {
  it("single-element contexts array", () => {
    const contexts: TaskCtx[] = [{ task: "solo", priority: 1 }];
    const factory = (_ctx: TaskCtx, i: number): BridgeParams => ({
      workdir: `/repo/single-${i}`,
    });
    const results = batchCommission(taskPrompt, contexts, factory);

    expect(results).toHaveLength(1);
    expect(results[0].prompt).toBe("Execute task: solo (priority 1)");
    expect(results[0].bridge.workdir).toBe("/repo/single-0");
  });

  it("large batch (10 items)", () => {
    const contexts: TaskCtx[] = Array.from({ length: 10 }, (_, i) => ({
      task: `task-${i}`,
      priority: i,
    }));
    const factory = (_ctx: TaskCtx, i: number): BridgeParams => ({
      workdir: `/repo/batch-${i}`,
    });
    const results = batchCommission(taskPrompt, contexts, factory);

    expect(results).toHaveLength(10);
    expect(results[0].prompt).toBe("Execute task: task-0 (priority 0)");
    expect(results[9].prompt).toBe("Execute task: task-9 (priority 9)");
    expect(results[9].bridge.workdir).toBe("/repo/batch-9");
  });

  it("bridgeFactory receives correct index and context", () => {
    const contexts: TaskCtx[] = [
      { task: "a", priority: 10 },
      { task: "b", priority: 20 },
    ];
    const receivedArgs: Array<{ ctx: TaskCtx; i: number }> = [];
    const factory = (ctx: TaskCtx, i: number): BridgeParams => {
      receivedArgs.push({ ctx, i });
      return { workdir: `/repo/${ctx.task}` };
    };
    batchCommission(taskPrompt, contexts, factory);

    expect(receivedArgs).toHaveLength(2);
    expect(receivedArgs[0]).toEqual({ ctx: { task: "a", priority: 10 }, i: 0 });
    expect(receivedArgs[1]).toEqual({ ctx: { task: "b", priority: 20 }, i: 1 });
  });
});

// ── End-to-end commission + template composition ──

describe("commission + template integration", () => {
  it("commission with templates.implementation produces full prompt", () => {
    const prompt = templates.implementation();
    const config: ImplementationConfig = {
      taskId: "WU-1.0",
      description: "Integrate module",
      scope: ["src/core.ts", "src/util.ts"],
      rules: ["Keep pure", "Test first"],
      branch: "feat/integrate",
    };
    const result = commission(prompt, config, baseBridge, {
      generatedAt: fixedDate,
      methodologyId: "P2-SD",
      methodId: "M3-IMPL",
      stepId: "s-code",
    });

    expect(result.prompt).toContain("## Role");
    expect(result.prompt).toContain("Integrate module");
    expect(result.prompt).toContain("## Scope");
    expect(result.prompt).toContain("- src/core.ts");
    expect(result.prompt).toContain("## Constraints");
    expect(result.prompt).toContain("1. Keep pure");
    expect(result.prompt).toContain("## Git");
    expect(result.prompt).toContain("Branch: feat/integrate");
    expect(result.context).toBe(config);
    expect(result.bridge).toBe(baseBridge);
    expect(result.metadata.methodologyId).toBe("P2-SD");
  });

  it("commission with templates.review produces full prompt", () => {
    const prompt = templates.review();
    const config: ReviewConfig = {
      target: "PR #55",
      criteria: ["Correctness", "Style"],
      advisors: ["expert-1"],
    };
    const result = commission(prompt, config, baseBridge);

    expect(result.prompt).toContain("## Role");
    expect(result.prompt).toContain("review sub-agent");
    expect(result.prompt).toContain("## Target");
    expect(result.prompt).toContain("Target: PR #55");
    expect(result.prompt).toContain("## Criteria");
    expect(result.prompt).toContain("1. Correctness");
    expect(result.prompt).toContain("## Advisors");
    expect(result.prompt).toContain("- expert-1");
  });

  it("commission with templates.council produces full prompt", () => {
    const prompt = templates.council();
    const config: CouncilConfig = {
      agenda: ["Budget review"],
      participants: ["CTO", "VP Eng"],
      projectCard: "Project XYZ essence",
    };
    const result = commission(prompt, config, baseBridge);

    expect(result.prompt).toContain("## Role");
    expect(result.prompt).toContain("steering council");
    expect(result.prompt).toContain("## Agenda");
    expect(result.prompt).toContain("1. Budget review");
    expect(result.prompt).toContain("## Participants");
    expect(result.prompt).toContain("- CTO");
    expect(result.prompt).toContain("## Project Card");
    expect(result.prompt).toContain("Project XYZ essence");
  });

  it("commission with templates.retro produces full prompt", () => {
    const prompt = templates.retro();
    const config: RetroConfig = {
      sessionId: "sess-200",
      trace: "Step 1: init. Step 2: execute.",
      focus: "latency",
    };
    const result = commission(prompt, config, baseBridge);

    expect(result.prompt).toContain("## Role");
    expect(result.prompt).toContain("retrospective agent");
    expect(result.prompt).toContain("## Session");
    expect(result.prompt).toContain("Session ID: sess-200");
    expect(result.prompt).toContain("## Trace");
    expect(result.prompt).toContain("Step 1: init");
    expect(result.prompt).toContain("## Focus");
    expect(result.prompt).toContain("Focus area: latency");
  });

  it("batchCommission with templates produces unique commissions", () => {
    const prompt = templates.implementation();
    const configs: ImplementationConfig[] = [
      { taskId: "T-1", description: "Task A", scope: ["a.ts"], rules: ["r1"] },
      { taskId: "T-2", description: "Task B", scope: ["b.ts"], rules: ["r2"] },
    ];
    const factory = (ctx: ImplementationConfig, i: number): BridgeParams => ({
      workdir: `/repo/agent-${i}`,
      nickname: `impl-${ctx.taskId}`,
    });
    const results = batchCommission(prompt, configs, factory, {
      generatedAt: fixedDate,
    });

    expect(results).toHaveLength(2);
    expect(results[0].prompt).toContain("Task A");
    expect(results[0].prompt).toContain("- a.ts");
    expect(results[0].bridge.nickname).toBe("impl-T-1");
    expect(results[1].prompt).toContain("Task B");
    expect(results[1].prompt).toContain("- b.ts");
    expect(results[1].bridge.nickname).toBe("impl-T-2");
    // Both share the same metadata
    expect(results[0].metadata.generatedAt).toBe(fixedDate);
    expect(results[1].metadata.generatedAt).toBe(fixedDate);
  });
});

// ── commission() with partial metadata combinations ──

describe("commission() — metadata edge cases", () => {
  it("preserves only methodologyId when others are absent", () => {
    const ctx: TaskCtx = { task: "partial-meta", priority: 1 };
    const result = commission(taskPrompt, ctx, baseBridge, {
      methodologyId: "P1-EXEC",
    });

    expect(result.metadata.methodologyId).toBe("P1-EXEC");
    expect(result.metadata.methodId).toBeUndefined();
    expect(result.metadata.stepId).toBeUndefined();
    expect(result.metadata.generatedAt).toBeInstanceOf(Date);
  });

  it("preserves only stepId when others are absent", () => {
    const ctx: TaskCtx = { task: "step-only", priority: 0 };
    const result = commission(taskPrompt, ctx, baseBridge, {
      stepId: "s-review",
    });

    expect(result.metadata.stepId).toBe("s-review");
    expect(result.metadata.methodologyId).toBeUndefined();
    expect(result.metadata.methodId).toBeUndefined();
  });

  it("empty metadata object defaults generatedAt", () => {
    const before = Date.now();
    const ctx: TaskCtx = { task: "empty-meta", priority: 0 };
    const result = commission(taskPrompt, ctx, baseBridge, {});
    const after = Date.now();

    expect(result.metadata.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.metadata.generatedAt.getTime()).toBeLessThanOrEqual(after);
    expect(result.metadata.methodologyId).toBeUndefined();
  });
});
