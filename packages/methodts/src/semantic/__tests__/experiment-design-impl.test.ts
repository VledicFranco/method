/**
 * Experiment: Design + Implement quality measurement via SPL pipeline.
 *
 * Uses the SPL algorithms directly — no file writing, no server spawning.
 * The LLM generates DesignOutput and ImplementOutput through the existing
 * typed parsers, and we evaluate in-memory with gate-runner + design-judge.
 *
 * Task: Design the Hatch project incubator API (3 domains, cross-domain ports).
 *
 * Conditions:
 *   - flat-design: single designLevel call with full context
 *   - recursive-design: design algorithm recursing L2 → L1
 *   - flat-implement: single implementLevel call given the flat design
 *
 * Metrics:
 *   - Algorithmic: gate-runner (no-any, no-todos, port-substance, structure)
 *   - Semantic: design-judge (decomposition, port-quality, docs, surface-first)
 *   - Composite: 50% algorithmic + 50% semantic for design
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { runSemantic } from "../run.js";
import { designLevel, createDesignWithFs, type DesignOutput } from "../algorithms/design.js";
import { implementLevel, implement } from "../algorithms/implement.js";
import { designJudge, computeDesignScore, computeImplementScore } from "../algorithms/design-judge.js";
import { runGates, type FileArtifact } from "../algorithms/gate-runner.js";
import { liveFsLoader } from "../algorithms/fs-loader.js";
import { SequenceProvider } from "../../testkit/provider/recording-provider.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── The Hatch API requirement (compact version for prompt) ──

const HATCH_REQUIREMENT = `Design a TypeScript HTTP API called "Hatch" — a project incubator with 3 domains:

1. projects/ — CRUD for projects (id, name, description, status: active/archived, createdAt)
2. tasks/ — Task lifecycle with state machine: todo → in_progress → done, todo → cancelled
   - Tasks belong to a project (must validate via ProjectLookupPort)
   - On state change, emit notification via NotificationPort
3. notifications/ — Records all events (task_created, task_transitioned, task_completed)

Cross-domain ports (PRIMARY DELIVERABLE):
- ProjectLookupPort: tasks consumes, projects owns — verify project exists
- NotificationPort: tasks consumes, notifications owns — emit events
- TaskStoragePort: internal to tasks — abstract persistence
- ProjectStoragePort: internal to projects — abstract persistence

Follow FCA: ports before architecture, co-located tests, composition root (server.ts), no \`any\` types, no TODOs.

Expected structure:
  projects/types.ts, storage-port.ts, storage.ts, service.ts, routes.ts, lookup-port.ts, index.ts
  tasks/types.ts, storage-port.ts, storage.ts, state-machine.ts, service.ts, routes.ts, index.ts
  notifications/types.ts, notification-port.ts, store.ts, service.ts, routes.ts, index.ts
  server.ts (composition root)`;

// ── Reference design (ground truth — what we know the structure should be) ──

const REFERENCE_DESIGN = `3 domains: projects (7 files), tasks (7 files), notifications (6 files).
Ports: ProjectLookupPort (interface with exists(id) method), NotificationPort (interface with notify(event) method),
TaskStoragePort (CRUD interface), ProjectStoragePort (CRUD interface).
State machine: pure function transitionTask(task, event) → task. No side effects.
Composition root: server.ts wires port implementations and starts HTTP server.`;

const REFERENCE_PORTS = `interface ProjectLookupPort { exists(projectId: string): Promise<boolean>; }
interface NotificationPort { notify(event: NotificationEvent): Promise<void>; }
interface TaskStoragePort { create(task: Task): Promise<Task>; get(id: string): Promise<Task | null>; list(filter?: { projectId?: string }): Promise<Task[]>; update(task: Task): Promise<Task>; }
interface ProjectStoragePort { create(project: Project): Promise<Project>; get(id: string): Promise<Project | null>; list(): Promise<Project[]>; delete(id: string): Promise<void>; }`;

// ── Result persistence ──

function persistResult(name: string, data: unknown): void {
  const dir = join(process.cwd(), "experiments/exp-spl-design/results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify(data, null, 2),
  );
}

// ── Deterministic tests ──

describe("Design+Implement experiment — deterministic", () => {
  it("designLevel parses Hatch API design from LLM output", async () => {
    const { layer } = SequenceProvider([{
      raw: `DOCUMENTATION:
# Hatch — Project Incubator API

A TypeScript HTTP service with 3 FCA domains: projects, tasks, and notifications.
Projects manages lifecycle. Tasks has a pure state machine with transitions through ports.
Notifications records events dispatched via NotificationPort.

All cross-domain access goes through typed port interfaces. Composition root at server.ts
wires implementations and starts the HTTP server.

PORTS:
PORT ProjectLookupPort
owner: projects
consumer: tasks
description: Verify project exists before task creation
interface: export interface ProjectLookupPort {
  exists(projectId: string): Promise<boolean>;
}
END_PORT

PORT NotificationPort
owner: notifications
consumer: tasks
description: Emit events on task state changes
interface: export interface NotificationPort {
  notify(event: { type: string; taskId: string; projectId: string; timestamp: string }): Promise<void>;
}
END_PORT

SUB_COMPONENTS:
- projects | Project CRUD, membership, ProjectLookupPort implementation | ports: ProjectLookupPort, ProjectStoragePort
- tasks | Task lifecycle, state machine, uses ProjectLookupPort + NotificationPort | ports: TaskStoragePort, ProjectLookupPort, NotificationPort
- notifications | Event store, NotificationPort implementation | ports: NotificationPort

ARCHITECTURE:
server.ts creates InMemoryProjectStorage, InMemoryTaskStorage, InMemoryNotificationStore.
It wires ProjectLookupPort from projects service, NotificationPort from notification store.
TaskService receives both ports via constructor injection. Routes delegate to services.`,
      cost: { tokens: 200, usd: 0.005, duration_ms: 500 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: HATCH_REQUIREMENT,
        path: "/hatch/src",
        level: 2,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types"],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("complete");
    expect(result.data.ports.length).toBeGreaterThanOrEqual(2);
    expect(result.data.subComponents.length).toBe(3);
    expect(result.data.portFileContent).toContain("ProjectLookupPort");
    expect(result.data.readmeContent).toContain("Hatch");

    // Run gate checks on the design output
    const portArtifacts: FileArtifact[] = result.data.ports.map((p) => ({
      path: `ports/${p.name}.ts`,
      content: p.methods,
      kind: "port" as const,
    }));
    const { passRate } = runGates(portArtifacts);
    expect(passRate).toBeGreaterThan(0.5);
  });

  it("implementLevel parses generated code from LLM output", async () => {
    const mockDesign: DesignOutput = {
      path: "/hatch/src/projects",
      level: 1,
      draftDocumentation: "Project domain — CRUD operations",
      ports: [{ name: "ProjectStoragePort", owner: "projects", consumer: "internal", description: "Abstract persistence", methods: "export interface ProjectStoragePort { get(id: string): Promise<Project | null>; }" }],
      portFileContent: "export interface ProjectStoragePort { get(id: string): Promise<Project | null>; }",
      readmeContent: "# Projects\nCRUD for projects.",
      subComponents: [],
      architectureNotes: "Service uses port, routes call service.",
      childDesigns: [],
    };

    const { layer } = SequenceProvider([{
      raw: `FILE: types.ts
KIND: implementation
\`\`\`typescript
export type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  createdAt: string;
};

export type CreateProjectInput = {
  name: string;
  description: string;
};
\`\`\`

FILE: storage-port.ts
KIND: port
\`\`\`typescript
import { Project, CreateProjectInput } from "./types.js";

export interface ProjectStoragePort {
  create(input: CreateProjectInput): Promise<Project>;
  get(id: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  delete(id: string): Promise<void>;
}
\`\`\`

FILE: service.ts
KIND: implementation
\`\`\`typescript
import { Project, CreateProjectInput } from "./types.js";
import { ProjectStoragePort } from "./storage-port.js";

export class ProjectService {
  constructor(private storage: ProjectStoragePort) {}

  async create(input: CreateProjectInput): Promise<Project> {
    return this.storage.create(input);
  }

  async get(id: string): Promise<Project | null> {
    return this.storage.get(id);
  }

  async list(): Promise<Project[]> {
    return this.storage.list();
  }

  async delete(id: string): Promise<void> {
    return this.storage.delete(id);
  }
}
\`\`\``,
      cost: { tokens: 300, usd: 0.008, duration_ms: 800 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(implementLevel, {
        design: mockDesign,
        path: "/hatch/src/projects",
        level: 1,
        frozenPorts: [],
        existingCode: "",
        constraints: [],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.files.length).toBeGreaterThanOrEqual(2);
    expect(result.data.files.some((f) => f.kind === "port")).toBe(true);
    expect(result.data.files.some((f) => f.kind === "implementation")).toBe(true);
    // Gate checks ran inline
    expect(result.data.gateResults.length).toBeGreaterThan(0);
  });

  it("design-judge scores a design against reference", async () => {
    const { layer } = SequenceProvider([{
      raw: `DECOMPOSITION: 4
PORT_QUALITY: 5
DOCUMENTATION: 3
SURFACE_FIRST: 4
RATIONALE: Good decomposition with all 3 domains identified plus correct ports. Port interfaces are minimal and typed. Documentation is present but could be more detailed. Ports clearly drive the architecture.`,
      cost: { tokens: 30, usd: 0.001, duration_ms: 100 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(designJudge, {
        requirement: HATCH_REQUIREMENT,
        generatedDesign: "3 domains: projects, tasks, notifications. Ports: ProjectLookupPort, NotificationPort.",
        referenceDesign: REFERENCE_DESIGN,
        generatedPorts: "interface ProjectLookupPort { exists(id: string): Promise<boolean>; }",
        referencePorts: REFERENCE_PORTS,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.decomposition).toBe(4);
    expect(result.data.portQuality).toBe(5);
    expect(result.data.overall).toBeCloseTo(4 * 0.35 + 5 * 0.30 + 3 * 0.20 + 4 * 0.15, 1);

    const composite = computeDesignScore(0.8, result.data);
    expect(composite).toBeGreaterThan(0.5);
  });
});

// ── Real LLM experiment ──

describe.skipIf(!!process.env.CI)("Design+Implement — real execution", () => {
  const getProvider = async () => {
    const { ClaudeHeadlessProvider } = await import("../../provider/claude-headless.js");
    return ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 5,
      workdir: process.cwd(),
      timeoutMs: 300000, // 5 min per call
    });
  };

  it("flat design: single call designs the full Hatch API", async () => {
    const provider = await getProvider();

    const result = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: HATCH_REQUIREMENT,
        path: "/hatch/src",
        level: 2,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types", "Co-located tests"],
      }).pipe(Effect.provide(provider)),
    );

    console.log("\n=== FLAT DESIGN RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Tokens: ${result.cost.tokens}, Cost: $${result.cost.usd.toFixed(4)}`);
    console.log(`Ports: ${result.data.ports.map((p) => p.name).join(", ")}`);
    console.log(`Sub-components: ${result.data.subComponents.map((s) => s.name).join(", ")}`);
    console.log(`Documentation (first 200): ${result.data.draftDocumentation.slice(0, 200)}`);

    // Algorithmic gate checks on ports
    const portArtifacts: FileArtifact[] = result.data.ports.map((p) => ({
      path: `ports/${p.name}.ts`, content: p.methods, kind: "port" as const,
    }));
    if (result.data.readmeContent) {
      portArtifacts.push({ path: "README.md", content: result.data.readmeContent, kind: "readme" });
    }
    const gates = runGates(portArtifacts, {
      requiredSections: ["Hatch", "port", "domain"],
    });
    console.log(`Gate pass rate: ${(gates.passRate * 100).toFixed(0)}%`);
    for (const g of gates.results) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }

    // Design judge
    const judgeResult = await Effect.runPromise(
      runSemantic(designJudge, {
        requirement: HATCH_REQUIREMENT,
        generatedDesign: result.data.draftDocumentation,
        referenceDesign: REFERENCE_DESIGN,
        generatedPorts: result.data.portFileContent,
        referencePorts: REFERENCE_PORTS,
      }).pipe(Effect.provide(provider)),
    );

    console.log(`\nDesign Judge: decomp=${judgeResult.data.decomposition} port=${judgeResult.data.portQuality} doc=${judgeResult.data.documentation} surface=${judgeResult.data.surfaceFirst} overall=${judgeResult.data.overall.toFixed(2)}`);
    console.log(`Rationale: ${judgeResult.data.rationale}`);

    // Composite score
    const composite = computeDesignScore(gates.passRate, judgeResult.data);
    console.log(`\nComposite score: ${(composite * 100).toFixed(1)}%`);

    // Persist
    persistResult("flat-design", {
      condition: "flat-design",
      tokens: result.cost.tokens,
      cost_usd: result.cost.usd,
      duration_ms: result.cost.duration_ms,
      ports: result.data.ports.length,
      subComponents: result.data.subComponents.length,
      gatePassRate: gates.passRate,
      judge: judgeResult.data,
      compositeScore: composite,
    });

    expect(result.data.ports.length).toBeGreaterThanOrEqual(2);
    expect(result.data.subComponents.length).toBeGreaterThanOrEqual(2);
  }, 300000);

  it("recursive design: L2→L1 recursion on Hatch API", async () => {
    const provider = await getProvider();
    const recursiveDesign = createDesignWithFs(liveFsLoader());

    const result = await Effect.runPromise(
      runSemantic(recursiveDesign, {
        requirement: HATCH_REQUIREMENT,
        path: "/hatch/src",
        level: 2,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types", "Co-located tests"],
      }).pipe(Effect.provide(provider)),
    );

    console.log("\n=== RECURSIVE DESIGN RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Tokens: ${result.cost.tokens}, Cost: $${result.cost.usd.toFixed(4)}`);
    console.log(`Ports: ${result.data.ports.map((p) => p.name).join(", ")}`);
    console.log(`Sub-components: ${result.data.subComponents.map((s) => s.name).join(", ")}`);
    console.log(`Child designs: ${result.data.childDesigns.length}`);
    for (const child of result.data.childDesigns) {
      console.log(`  L${child.level} ${child.path}: ${child.ports.length} ports, ${child.subComponents.length} sub-components`);
    }

    // Algorithmic gate checks on all ports (root + children)
    const allPorts = [
      ...result.data.ports,
      ...result.data.childDesigns.flatMap((c) => c.ports),
    ];
    const portArtifacts: FileArtifact[] = allPorts.map((p) => ({
      path: `ports/${p.name}.ts`, content: p.methods, kind: "port" as const,
    }));
    if (result.data.readmeContent) {
      portArtifacts.push({ path: "README.md", content: result.data.readmeContent, kind: "readme" });
    }
    const gates = runGates(portArtifacts, {
      requiredSections: ["Hatch", "port", "domain"],
    });
    console.log(`Gate pass rate: ${(gates.passRate * 100).toFixed(0)}%`);
    for (const g of gates.results) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }

    // Design judge
    const judgeResult = await Effect.runPromise(
      runSemantic(designJudge, {
        requirement: HATCH_REQUIREMENT,
        generatedDesign: [
          result.data.draftDocumentation,
          ...result.data.childDesigns.map((c) =>
            `\n--- Child L${c.level} ${c.path} ---\n${c.draftDocumentation}`),
        ].join("\n"),
        referenceDesign: REFERENCE_DESIGN,
        generatedPorts: [
          result.data.portFileContent,
          ...result.data.childDesigns.map((c) => c.portFileContent).filter(Boolean),
        ].join("\n\n"),
        referencePorts: REFERENCE_PORTS,
      }).pipe(Effect.provide(provider)),
    );

    console.log(`\nDesign Judge: decomp=${judgeResult.data.decomposition} port=${judgeResult.data.portQuality} doc=${judgeResult.data.documentation} surface=${judgeResult.data.surfaceFirst} overall=${judgeResult.data.overall.toFixed(2)}`);
    console.log(`Rationale: ${judgeResult.data.rationale}`);

    const composite = computeDesignScore(gates.passRate, judgeResult.data);
    console.log(`\nComposite score: ${(composite * 100).toFixed(1)}%`);

    persistResult("recursive-design", {
      condition: "recursive-design",
      tokens: result.cost.tokens,
      cost_usd: result.cost.usd,
      duration_ms: result.cost.duration_ms,
      ports: allPorts.length,
      subComponents: result.data.subComponents.length,
      childDesigns: result.data.childDesigns.length,
      childPorts: result.data.childDesigns.map((c) => ({
        path: c.path, ports: c.ports.length, subComponents: c.subComponents.length,
      })),
      gatePassRate: gates.passRate,
      judge: judgeResult.data,
      compositeScore: composite,
    });

    expect(result.data.ports.length).toBeGreaterThanOrEqual(2);
    expect(result.data.childDesigns.length).toBeGreaterThanOrEqual(2);
  }, 600000); // Recursive needs more time — multiple LLM calls

  it("flat implement: single call implements from flat design", async () => {
    const provider = await getProvider();

    // First, get a design to implement from
    const designResult = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: HATCH_REQUIREMENT,
        path: "/hatch/src/projects",
        level: 1,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types"],
      }).pipe(Effect.provide(provider)),
    );

    console.log("\n=== FLAT IMPLEMENT RESULT ===");
    console.log(`Design produced: ${designResult.data.ports.length} ports, ${designResult.data.subComponents.length} sub-components`);

    // Now implement from that design
    const implResult = await Effect.runPromise(
      runSemantic(implementLevel, {
        design: designResult.data,
        path: "/hatch/src/projects",
        level: 1,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Files: ${implResult.data.files.length}`);
    for (const f of implResult.data.files) {
      console.log(`  ${f.kind}: ${f.path} (${f.content.length} chars)`);
    }
    console.log(`Gates: ${implResult.data.gateResults.length}, all pass: ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    const gatePassRate = implResult.data.gateResults.filter((g) => g.passed).length / implResult.data.gateResults.length;
    const composite = computeImplementScore(gatePassRate, 3.0); // Conservative judge estimate for now
    console.log(`\nGate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("flat-implement", {
      condition: "flat-implement",
      designTokens: designResult.cost.tokens,
      implTokens: implResult.cost.tokens,
      totalTokens: designResult.cost.tokens + implResult.cost.tokens,
      cost_usd: designResult.cost.usd + implResult.cost.usd,
      duration_ms: designResult.cost.duration_ms + implResult.cost.duration_ms,
      files: implResult.data.files.length,
      filesByKind: implResult.data.files.map((f) => ({ path: f.path, kind: f.kind })),
      gateResults: implResult.data.gateResults,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass,
      compositeScore: composite,
    });

    expect(implResult.data.files.length).toBeGreaterThanOrEqual(2);
  }, 600000);

  it("pipeline implement: gate-check-fix loop with recursive decomposition", async () => {
    const provider = await getProvider();

    // Get a recursive design first (L2→L1) to feed the pipeline
    const designResult = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: HATCH_REQUIREMENT,
        path: "/hatch/src",
        level: 2,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types"],
      }).pipe(Effect.provide(provider)),
    );

    console.log("\n=== PIPELINE IMPLEMENT RESULT ===");
    console.log(`Design: ${designResult.data.ports.length} ports, ${designResult.data.subComponents.length} sub-components`);

    // Pipeline implement with gate-check-fix loop
    const implResult = await Effect.runPromise(
      runSemantic(implement, {
        design: designResult.data,
        path: "/hatch/src",
        level: 2,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs", "Complete implementations only"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Root files: ${implResult.data.files.length}`);
    for (const f of implResult.data.files) {
      console.log(`  ${f.kind}: ${f.path} (${f.content.length} chars)`);
    }
    console.log(`Root gates: all pass = ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }
    console.log(`Child implementations: ${implResult.data.childImplementations.length}`);
    for (const child of implResult.data.childImplementations) {
      console.log(`  ${child.path}: ${child.files.length} files, gates pass = ${child.allGatesPass}`);
    }
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    // Aggregate gate pass rate across root + children
    const allGates = [
      ...implResult.data.gateResults,
      ...implResult.data.childImplementations.flatMap((c) => c.gateResults),
    ];
    const gatePassRate = allGates.filter((g) => g.passed).length / allGates.length;
    const composite = computeImplementScore(gatePassRate, 3.0);
    console.log(`\nAggregate gate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("pipeline-implement", {
      condition: "pipeline-implement",
      tokens: implResult.cost.tokens,
      cost_usd: implResult.cost.usd,
      duration_ms: implResult.cost.duration_ms,
      rootFiles: implResult.data.files.length,
      childImplementations: implResult.data.childImplementations.map((c) => ({
        path: c.path,
        files: c.files.length,
        allGatesPass: c.allGatesPass,
      })),
      gateResults: allGates,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass,
      compositeScore: composite,
    });

    expect(implResult.data.files.length).toBeGreaterThanOrEqual(1);
    // H1-Implement: pipeline should achieve ≥80% gate pass rate
    console.log(`\nH1-Implement check: gate pass rate ${(gatePassRate * 100).toFixed(0)}% (target: ≥80%)`);
  }, 600000);
});

// ═══════════════════════════════════════════════════════════════════
// T-Large: Bridge server — 10 domains, 6 shared ports, L3→L2→L1
// ═══════════════════════════════════════════════════════════════════
//
// Tests the crossover hypothesis: at what task size does recursive
// design outperform flat? The Hatch API (3 domains) was too small —
// flat won. The bridge (10 domains) should saturate a single context.

const BRIDGE_REQUIREMENT = `Design a TypeScript agent orchestration server called "Bridge" — an HTTP/WebSocket server that manages LLM agent sessions, methodology execution, strategy pipelines, and multi-project coordination. 10 FCA domains, 6 shared ports.

DOMAINS (10):

1. sessions/ — Agent session lifecycle. Owns the SessionPool: create sessions (with workdir, prompt, isolation mode, parent chain, budget), send prompts, stream responses, kill sessions, track stale sessions. Supports worktree isolation (git worktree per session). Sessions have parent-child chains with depth/budget enforcement. ~20 files (pool, channels, diagnostics, persistence, routes).

2. methodology/ — Methodology execution state. Stores per-session methodology state (current step, transition history). Routes methodology operations (load, transition, validate) through MethodologySource port. ~3 files.

3. strategies/ — Strategy pipeline execution engine. Parses YAML strategy DAGs (nodes with steps, gates between nodes). Executes nodes by spawning sessions via SessionPool. Gates check pass/fail conditions. Supports human approval gates, artifacts, retrospectives. ~13 files.

4. projects/ — Multi-project discovery and event persistence. Scans filesystem for project directories, reads project metadata (project-card.yaml). Persists per-project event logs (JSONL). Tracks cursor positions for incremental reads. ~7 files.

5. triggers/ — Event-driven trigger system. Watches for events (file changes, git commits, webhooks, cron schedules, session observations) and fires strategy executions. TriggerRouter dispatches events to matching triggers. Each trigger type has its own adapter. ~15 files.

6. tokens/ — LLM token usage tracking. Polls Claude CLI usage files, tracks per-session token counts, aggregates cost. Checks subscription limits. ~6 files.

7. registry/ — Methodology registry management. Copies methodology and strategy YAML files between projects and the central registry. ~4 files.

8. genesis/ — Multi-project agent orchestration. Spawns "genesis" agents that coordinate work across multiple projects. Produces ambient UI summaries (30s batched). ~6 files.

9. experiments/ — Cognitive experiment lab. Runs programmatic experiments comparing agent configurations. Tracks experiment telemetry via event bus. ~6 files.

10. cluster/ — Cluster coordination. Peer discovery (mDNS, Tailscale), event federation between bridge instances, HTTP adapters for node communication. ~8 files.

SHARED PORTS (defined in ports/, consumed via constructor injection, wired in composition root):

- EventBus: Universal event backbone. emit(event) → BridgeEvent (bus assigns id, timestamp, sequence). subscribe(filter, handler). query(filter, options). registerSink(sink). Events have: domain, type, severity, projectId?, sessionId?, payload, source, correlationId?. Consumed by: sessions, methodology, strategies, projects, triggers, cluster, experiments.

- SessionPool: Session lifecycle manager. create(options) → {sessionId, nickname, chain, worktree}. prompt(sessionId, text) → {output, metadata}. promptStream(sessionId, text, onEvent). kill(sessionId). list(). status(sessionId). Owned by sessions domain, consumed by: strategies, methodology, genesis.

- FileSystemProvider: Abstracted filesystem I/O. Sync methods: readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync. Async methods: readFile, writeFile, readdir, stat, mkdir. Consumed by: sessions, projects, strategies, tokens, triggers, genesis, registry.

- YamlLoader: YAML parse/dump. load(content) → unknown. dump(value) → string. Consumed by: projects, strategies, triggers, registry, experiments.

- MethodologySource: Methodology data access. list() → CatalogEntry[]. getMethod(methodologyId, methodId). getMethodology(id). Consumed by: methodology.

- NativeSessionDiscovery: Discovers live Claude CLI sessions from OS PID files. listLiveSessions() → NativeSessionInfo[]. Used by sessions domain for startup recovery.

COMPOSITION ROOT (server-entry.ts):
Creates all port implementations, constructs domain services, registers routes on Fastify, registers EventBus sinks (WebSocket, persistence, channels, federation). Starts HTTP server.

FCA RULES: All cross-domain communication through ports. No direct domain-to-domain imports. Each domain co-locates its types, logic, routes, tests, and config. Composition root is the only place that sees all domains.

Expected L2 structure: 10 domain directories + ports/ + shared/ + server-entry.ts
Expected cross-domain ports: 6 port interface files in ports/`;

const BRIDGE_REFERENCE_DESIGN = `10 domains: sessions (~20 files, owns SessionPool), methodology (~3 files), strategies (~13 files), projects (~7 files), triggers (~15 files), tokens (~6 files), registry (~4 files), genesis (~6 files), experiments (~6 files), cluster (~8 files).

6 shared ports in ports/:
- EventBus: emit(BridgeEventInput) → BridgeEvent, subscribe(filter, handler), query(filter, options), registerSink(sink). Events have domain/type/severity/payload/source fields. Bus assigns id/timestamp/sequence.
- SessionPool: create(options with workdir, prompt, isolation, chain, budget) → session info. prompt(id, text) → output. promptStream(id, text, onEvent). kill(id). list(). status(id). Supports worktree isolation and parent-child chains.
- FileSystemProvider: sync (readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync) + async (readFile, writeFile, readdir, stat, mkdir).
- YamlLoader: load(content) → unknown, dump(value) → string.
- MethodologySource: list() → CatalogEntry[], getMethod(methodologyId, methodId), getMethodology(id).
- NativeSessionDiscovery: listLiveSessions() → NativeSessionInfo[].

Composition root: server-entry.ts creates all port implementations, wires domains, registers Fastify routes, registers EventBus sinks (WebSocket, persistence, channels, federation).

Key patterns: EventBus is the coordination backbone (7 domains consume it). SessionPool is owned by sessions, consumed by strategies/methodology/genesis. FileSystemProvider is the most widely consumed port (7 domains). All cross-domain interaction through ports — no direct imports.`;

const BRIDGE_REFERENCE_PORTS = `interface EventBus {
  emit(event: BridgeEventInput): BridgeEvent;
  importEvent(event: BridgeEvent): void;
  subscribe(filter: EventFilter, handler: (event: BridgeEvent) => void): EventSubscription;
  query(filter: EventFilter, options?: { limit?: number; since?: string }): BridgeEvent[];
  registerSink(sink: EventSink): void;
}
interface SessionPool {
  create(options: { workdir: string; initialPrompt?: string; parentSessionId?: string; depth?: number; budget?: Partial<SessionBudget>; isolation?: IsolationMode; nickname?: string; purpose?: string; mode?: SessionMode; }): Promise<{ sessionId: string; nickname: string; chain: SessionChainInfo; worktree: WorktreeInfo; mode: SessionMode }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number): Promise<{ output: string; timedOut: boolean; metadata: PrintMetadata | null }>;
  promptStream(sessionId: string, prompt: string, onEvent: (event: StreamEvent) => void, timeoutMs?: number): Promise<void>;
  status(sessionId: string): SessionStatusInfo;
  kill(sessionId: string, worktreeAction?: WorktreeAction): { sessionId: string; killed: boolean; worktree_cleaned: boolean };
  list(): SessionStatusInfo[];
}
interface FileSystemProvider {
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, content: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): FileStat;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string, encoding: BufferEncoding): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}
interface YamlLoader { load(content: string): unknown; dump(value: unknown): string; }
interface MethodologySource { list(): CatalogMethodologyEntry[]; getMethod(methodologyId: string, methodId: string): Method | undefined; getMethodology(methodologyId: string): Methodology | undefined; }
interface NativeSessionDiscovery { listLiveSessions(): Promise<NativeSessionInfo[]>; }`;

// ── T-Large: helper to run a design condition and evaluate ──

import type { Layer } from "effect";
import type { AgentProvider } from "../../provider/agent-provider.js";
import type { DesignInput } from "../algorithms/design.js";
import type { SemanticFn } from "../fn.js";

async function runDesignCondition(
  name: string,
  requirement: string,
  referenceDesign: string,
  referencePorts: string,
  designFn: SemanticFn<DesignInput, DesignOutput>,
  input: DesignInput,
  provider: Layer.Layer<AgentProvider>,
  requiredSections: string[],
) {
  const result = await Effect.runPromise(
    runSemantic(designFn, input).pipe(Effect.provide(provider)),
  );

  console.log(`\n=== ${name.toUpperCase()} ===`);
  console.log(`Status: ${result.status}`);
  console.log(`Tokens: ${result.cost.tokens}, Cost: $${result.cost.usd.toFixed(4)}`);
  console.log(`Ports: ${result.data.ports.map((p: any) => p.name).join(", ")}`);
  console.log(`Sub-components: ${result.data.subComponents.map((s: any) => s.name).join(", ")}`);
  console.log(`Child designs: ${result.data.childDesigns.length}`);

  // Collect all ports (root + children, recursively)
  function collectPorts(d: DesignOutput): DesignOutput["ports"][number][] {
    return [...d.ports, ...d.childDesigns.flatMap(collectPorts)];
  }
  function collectDocs(d: DesignOutput): string {
    return [d.draftDocumentation, ...d.childDesigns.map((c) =>
      `\n--- Child L${c.level} ${c.path} ---\n${collectDocs(c)}`)].join("\n");
  }
  function collectPortCode(d: DesignOutput): string {
    return [d.portFileContent, ...d.childDesigns.map((c) => collectPortCode(c))].filter(Boolean).join("\n\n");
  }

  const allPorts = collectPorts(result.data);
  const portArtifacts: FileArtifact[] = allPorts.map((p) => ({
    path: `ports/${p.name}.ts`, content: p.methods, kind: "port" as const,
  }));
  if (result.data.readmeContent) {
    portArtifacts.push({ path: "README.md", content: result.data.readmeContent, kind: "readme" });
  }
  const gates = runGates(portArtifacts, { requiredSections });
  console.log(`Gate pass rate: ${(gates.passRate * 100).toFixed(0)}%`);
  for (const g of gates.results) {
    console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
  }

  // Judge
  const judgeResult = await Effect.runPromise(
    runSemantic(designJudge, {
      requirement,
      generatedDesign: collectDocs(result.data),
      referenceDesign,
      generatedPorts: collectPortCode(result.data),
      referencePorts,
    }).pipe(Effect.provide(provider)),
  );

  console.log(`Judge: decomp=${judgeResult.data.decomposition} port=${judgeResult.data.portQuality} doc=${judgeResult.data.documentation} surface=${judgeResult.data.surfaceFirst} overall=${judgeResult.data.overall.toFixed(2)}`);
  console.log(`Rationale: ${judgeResult.data.rationale}`);

  const composite = computeDesignScore(gates.passRate, judgeResult.data);
  console.log(`Composite: ${(composite * 100).toFixed(1)}%`);

  persistResult(name, {
    condition: name,
    task: "bridge",
    tokens: result.cost.tokens,
    cost_usd: result.cost.usd,
    duration_ms: result.cost.duration_ms,
    ports: allPorts.length,
    subComponents: result.data.subComponents.length,
    childDesigns: result.data.childDesigns.length,
    gatePassRate: gates.passRate,
    judge: judgeResult.data,
    compositeScore: composite,
  });

  return { result, gates, judgeResult, composite };
}

// ── T-Large real LLM experiment ──

describe.skipIf(!!process.env.CI)("T-Large: Bridge design — 10 domains", () => {
  const getProvider = async () => {
    const { ClaudeHeadlessProvider } = await import("../../provider/claude-headless.js");
    return ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 5,
      workdir: process.cwd(),
      timeoutMs: 300000,
    });
  };

  it("flat design: single call designs the full bridge", async () => {
    const provider = await getProvider();

    const { result, composite } = await runDesignCondition(
      "flat-design-bridge",
      BRIDGE_REQUIREMENT,
      BRIDGE_REFERENCE_DESIGN,
      BRIDGE_REFERENCE_PORTS,
      designLevel,
      {
        requirement: BRIDGE_REQUIREMENT,
        path: "/bridge/src",
        level: 3, // L3 — package level (contains L2 domains)
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types", "All cross-domain communication through ports"],
      },
      provider,
      ["bridge", "port", "domain"],
    );

    console.log(`\n--- T-Large flat: ${result.data.subComponents.length} sub-components, ${result.data.ports.length} ports, composite ${(composite * 100).toFixed(1)}%`);

    expect(result.data.ports.length).toBeGreaterThanOrEqual(3);
    expect(result.data.subComponents.length).toBeGreaterThanOrEqual(5);
  }, 300000);

  it("recursive design: L3→L2 recursion on bridge", async () => {
    const provider = await getProvider();
    const { testFsLoader } = await import("../algorithms/fs-loader.js");
    const recursiveDesign = createDesignWithFs(testFsLoader({})); // Empty — no filesystem hints

    const { result, composite } = await runDesignCondition(
      "recursive-design-bridge",
      BRIDGE_REQUIREMENT,
      BRIDGE_REFERENCE_DESIGN,
      BRIDGE_REFERENCE_PORTS,
      recursiveDesign,
      {
        requirement: BRIDGE_REQUIREMENT,
        path: "/bridge/src",
        level: 3,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types", "All cross-domain communication through ports"],
      },
      provider,
      ["bridge", "port", "domain"],
    );

    console.log(`\n--- T-Large recursive: ${result.data.childDesigns.length} child designs, composite ${(composite * 100).toFixed(1)}%`);

    expect(result.data.ports.length).toBeGreaterThanOrEqual(3);
    // Recursive should produce child designs for each sub-component
    expect(result.data.childDesigns.length).toBeGreaterThanOrEqual(3);
  }, 600000);
});

// ═══════════════════════════════════════════════════════════════════
// T-Large Implementation: Bridge — flat vs recursive implement
// ═══════════════════════════════════════════════════════════════════
//
// The design experiment showed flat design wins at any scale (design
// is structural, not informational). Implementation is where context
// saturation should matter — the LLM must generate actual code for
// each domain, not just name interfaces.
//
// Both conditions use the same design output (from a fresh flat
// design call) to isolate the implementation strategy variable.

describe.skipIf(!!process.env.CI)("T-Large: Bridge implement — 10 domains", () => {
  const getProvider = async () => {
    const { ClaudeHeadlessProvider } = await import("../../provider/claude-headless.js");
    return ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 5,
      workdir: process.cwd(),
      timeoutMs: 300000,
    });
  };

  // Shared: get a bridge design to implement from
  async function getBridgeDesign(provider: Layer.Layer<AgentProvider>) {
    return Effect.runPromise(
      runSemantic(designLevel, {
        requirement: BRIDGE_REQUIREMENT,
        path: "/bridge/src",
        level: 3,
        existingDocs: "",
        existingChildren: [],
        constraints: ["FCA port discipline", "No any types", "All cross-domain communication through ports"],
      }).pipe(Effect.provide(provider)),
    );
  }

  it("flat implement: single call implements full bridge from design", async () => {
    const provider = await getProvider();
    const designResult = await getBridgeDesign(provider);

    console.log("\n=== FLAT IMPLEMENT BRIDGE ===");
    console.log(`Design: ${designResult.data.ports.length} ports, ${designResult.data.subComponents.length} sub-components`);

    const implResult = await Effect.runPromise(
      runSemantic(implementLevel, {
        design: designResult.data,
        path: "/bridge/src",
        level: 3,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs", "Complete implementations only"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Files: ${implResult.data.files.length}`);
    const byKind = implResult.data.files.reduce((acc, f) => {
      acc[f.kind] = (acc[f.kind] || 0) + 1; return acc;
    }, {} as Record<string, number>);
    console.log(`By kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`Gates: all pass = ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    const gatePassRate = implResult.data.gateResults.filter((g) => g.passed).length / implResult.data.gateResults.length;
    const composite = computeImplementScore(gatePassRate, 3.0);
    console.log(`Gate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("flat-implement-bridge", {
      condition: "flat-implement-bridge",
      task: "bridge",
      designTokens: designResult.cost.tokens,
      implTokens: implResult.cost.tokens,
      totalTokens: designResult.cost.tokens + implResult.cost.tokens,
      cost_usd: designResult.cost.usd + implResult.cost.usd,
      duration_ms: designResult.cost.duration_ms + implResult.cost.duration_ms,
      files: implResult.data.files.length,
      filesByKind: byKind,
      gateResults: implResult.data.gateResults,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass,
      compositeScore: composite,
    });

    expect(implResult.data.files.length).toBeGreaterThanOrEqual(5);
  }, 600000);

  it("recursive implement: per-domain implementation with gate-check-fix", async () => {
    const provider = await getProvider();
    const designResult = await getBridgeDesign(provider);

    console.log("\n=== RECURSIVE IMPLEMENT BRIDGE ===");
    console.log(`Design: ${designResult.data.ports.length} ports, ${designResult.data.subComponents.length} sub-components`);

    const implResult = await Effect.runPromise(
      runSemantic(implement, {
        design: designResult.data,
        path: "/bridge/src",
        level: 3,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs", "Complete implementations only"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Root files: ${implResult.data.files.length}`);
    const rootByKind = implResult.data.files.reduce((acc, f) => {
      acc[f.kind] = (acc[f.kind] || 0) + 1; return acc;
    }, {} as Record<string, number>);
    console.log(`Root by kind: ${Object.entries(rootByKind).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`Root gates: all pass = ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }

    console.log(`Child implementations: ${implResult.data.childImplementations.length}`);
    let totalChildFiles = 0;
    for (const child of implResult.data.childImplementations) {
      totalChildFiles += child.files.length;
      console.log(`  ${child.path}: ${child.files.length} files, gates pass = ${child.allGatesPass}`);
    }

    console.log(`Total files: ${implResult.data.files.length + totalChildFiles} (root: ${implResult.data.files.length}, children: ${totalChildFiles})`);
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    // Aggregate gates across root + children
    const allGates = [
      ...implResult.data.gateResults,
      ...implResult.data.childImplementations.flatMap((c) => c.gateResults),
    ];
    const gatePassRate = allGates.length > 0
      ? allGates.filter((g) => g.passed).length / allGates.length
      : 0;
    const composite = computeImplementScore(gatePassRate, 3.0);
    console.log(`Aggregate gate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("recursive-implement-bridge", {
      condition: "recursive-implement-bridge",
      task: "bridge",
      designTokens: designResult.cost.tokens,
      implTokens: implResult.cost.tokens,
      totalTokens: designResult.cost.tokens + implResult.cost.tokens,
      cost_usd: designResult.cost.usd + implResult.cost.usd,
      duration_ms: designResult.cost.duration_ms + implResult.cost.duration_ms,
      rootFiles: implResult.data.files.length,
      childImplementations: implResult.data.childImplementations.map((c) => ({
        path: c.path, files: c.files.length, allGatesPass: c.allGatesPass,
      })),
      totalFiles: implResult.data.files.length + totalChildFiles,
      gateResults: allGates,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass && implResult.data.childImplementations.every((c) => c.allGatesPass),
      compositeScore: composite,
    });

    expect(implResult.data.files.length).toBeGreaterThanOrEqual(1);
    console.log(`\nH2-Implement: recursive gate pass rate ${(gatePassRate * 100).toFixed(0)}% (target: higher than flat)`);
  }, 600000);
});

// ═══════════════════════════════════════════════════════════════════
// T-Large v2: Synthetic design with childDesigns populated
// ═══════════════════════════════════════════════════════════════════
//
// Previous run was inconclusive — implement recurses over childDesigns,
// but flat design produces childDesigns=[]. This test uses a hand-crafted
// DesignOutput with populated children so implement actually recurses.
//
// Flat: single implementLevel call with the full synthetic design
// Recursive: implement recurses into each of 5 child designs separately

function makeBridgeDesign(): DesignOutput {
  const ports = [
    { name: "EventBus", owner: "infrastructure", consumer: "all domains", description: "Universal event backbone", methods: "export interface EventBus { emit(event: { domain: string; type: string; payload: Record<string, unknown> }): { id: string; timestamp: string }; subscribe(filter: { domain?: string }, handler: (event: { id: string; domain: string; type: string; payload: Record<string, unknown> }) => void): { unsubscribe: () => void }; }" },
    { name: "SessionPool", owner: "sessions", consumer: "strategies, genesis", description: "Agent session lifecycle", methods: "export interface SessionPool { create(options: { workdir: string; prompt?: string; nickname?: string }): Promise<{ sessionId: string; nickname: string }>; prompt(sessionId: string, text: string): Promise<{ output: string }>; kill(sessionId: string): { killed: boolean }; list(): Array<{ sessionId: string; status: string }>; }" },
    { name: "FileSystemProvider", owner: "infrastructure", consumer: "most domains", description: "Abstracted filesystem I/O", methods: "export interface FileSystemProvider { readFileSync(path: string): string; writeFileSync(path: string, content: string): void; existsSync(path: string): boolean; readdirSync(path: string): string[]; mkdirSync(path: string, options?: { recursive?: boolean }): void; }" },
    { name: "YamlLoader", owner: "infrastructure", consumer: "projects, strategies, triggers", description: "YAML parse/dump", methods: "export interface YamlLoader { load(content: string): unknown; dump(value: unknown): string; }" },
  ];

  const childDesigns: DesignOutput[] = [
    {
      path: "/bridge/src/domains/sessions", level: 2,
      draftDocumentation: "Session domain — manages agent session lifecycle via SessionPool. Creates PTY sessions with workdir, handles prompt/response cycles, tracks session chains (parent-child with budget), supports worktree isolation. Emits session events to EventBus.",
      ports: [ports[1]], // SessionPool
      portFileContent: ports[1].methods,
      readmeContent: "# Sessions\nAgent session lifecycle management.",
      subComponents: [], architectureNotes: "Pool creates sessions, channels parse output, diagnostics track health.",
      childDesigns: [],
    },
    {
      path: "/bridge/src/domains/strategies", level: 2,
      draftDocumentation: "Strategy domain — executes YAML strategy pipelines as DAGs. Each node is a step executed by spawning a session via SessionPool. Gates between nodes check pass/fail. Supports artifacts, retros, and human approval gates. Emits strategy events to EventBus.",
      ports: [], portFileContent: "",
      readmeContent: "# Strategies\nStrategy pipeline execution engine.",
      subComponents: [], architectureNotes: "Executor parses DAG, runs nodes via SessionPool, gates check conditions.",
      childDesigns: [],
    },
    {
      path: "/bridge/src/domains/projects", level: 2,
      draftDocumentation: "Projects domain — discovers projects on the filesystem, reads project-card.yaml metadata, persists per-project event logs as JSONL files. Provides project listing and event query APIs. Uses FileSystemProvider and YamlLoader.",
      ports: [], portFileContent: "",
      readmeContent: "# Projects\nMulti-project discovery and event persistence.",
      subComponents: [], architectureNotes: "Discovery scans dirs, registry reads metadata, event log appends JSONL.",
      childDesigns: [],
    },
    {
      path: "/bridge/src/domains/triggers", level: 2,
      draftDocumentation: "Triggers domain — event-driven trigger system. TriggerRouter dispatches events to matching triggers. Trigger types: file watcher (fs changes), git observer (commits), cron scheduler, webhook receiver, session observer (PTY output patterns). Each fires strategy executions. Uses EventBus, FileSystemProvider, YamlLoader.",
      ports: [], portFileContent: "",
      readmeContent: "# Triggers\nEvent-driven trigger system.",
      subComponents: [], architectureNotes: "Router matches events to triggers, each adapter type handles its source.",
      childDesigns: [],
    },
    {
      path: "/bridge/src/domains/tokens", level: 2,
      draftDocumentation: "Tokens domain — LLM token usage tracking. Polls Claude CLI usage files from ~/.claude/usage/, aggregates per-session token counts, computes cost estimates. Checks subscription limits. Uses FileSystemProvider.",
      ports: [], portFileContent: "",
      readmeContent: "# Tokens\nLLM token usage tracking and cost estimation.",
      subComponents: [], architectureNotes: "Tracker polls usage files, aggregator computes totals, poller runs on interval.",
      childDesigns: [],
    },
  ];

  return {
    path: "/bridge/src", level: 3,
    draftDocumentation: "Bridge — agent orchestration server with 10 FCA domains. Sessions manages agent lifecycle via SessionPool. Strategies executes YAML pipelines. Projects discovers and tracks projects. Triggers fires strategies on events. Tokens tracks LLM usage. All cross-domain communication through typed ports (EventBus, SessionPool, FileSystemProvider, YamlLoader). Composition root wires ports and starts Fastify server.",
    ports,
    portFileContent: ports.map((p) => p.methods).join("\n\n"),
    readmeContent: "# Bridge\nAgent orchestration server — 10 domains, 4 shared ports.",
    subComponents: childDesigns.map((c) => ({
      name: c.path.split("/").pop()!,
      path: c.path, level: c.level,
      purpose: c.draftDocumentation.split(".")[0],
      ports: c.ports,
    })),
    architectureNotes: "Composition root creates port implementations, injects into domain services, registers Fastify routes.",
    childDesigns,
  };
}

describe.skipIf(!!process.env.CI)("T-Large v2: Bridge implement with synthetic childDesigns", () => {
  const getProvider = async () => {
    const { ClaudeHeadlessProvider } = await import("../../provider/claude-headless.js");
    return ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 5,
      workdir: process.cwd(),
      timeoutMs: 300000,
    });
  };

  const syntheticDesign = makeBridgeDesign();

  it("flat implement: single call with full synthetic design", async () => {
    const provider = await getProvider();

    console.log("\n=== FLAT IMPLEMENT (SYNTHETIC DESIGN) ===");
    console.log(`Design: ${syntheticDesign.ports.length} ports, ${syntheticDesign.childDesigns.length} child designs`);

    const implResult = await Effect.runPromise(
      runSemantic(implementLevel, {
        design: syntheticDesign,
        path: "/bridge/src",
        level: 3,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs", "Complete implementations only"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Files: ${implResult.data.files.length}`);
    const byKind = implResult.data.files.reduce((acc, f) => {
      acc[f.kind] = (acc[f.kind] || 0) + 1; return acc;
    }, {} as Record<string, number>);
    console.log(`By kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`Gates: all pass = ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    const gatePassRate = implResult.data.gateResults.filter((g) => g.passed).length / implResult.data.gateResults.length;
    const composite = computeImplementScore(gatePassRate, 3.0);
    console.log(`Gate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("flat-implement-synthetic", {
      condition: "flat-implement-synthetic",
      task: "bridge-synthetic-5-children",
      tokens: implResult.cost.tokens,
      cost_usd: implResult.cost.usd,
      duration_ms: implResult.cost.duration_ms,
      files: implResult.data.files.length,
      filesByKind: byKind,
      gateResults: implResult.data.gateResults,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass,
      compositeScore: composite,
    });

    expect(implResult.data.files.length).toBeGreaterThanOrEqual(3);
  }, 600000);

  it("recursive implement: per-domain with gate-check-fix (5 children)", async () => {
    const provider = await getProvider();

    console.log("\n=== RECURSIVE IMPLEMENT (SYNTHETIC DESIGN) ===");
    console.log(`Design: ${syntheticDesign.ports.length} ports, ${syntheticDesign.childDesigns.length} child designs`);

    const implResult = await Effect.runPromise(
      runSemantic(implement, {
        design: syntheticDesign,
        path: "/bridge/src",
        level: 3,
        frozenPorts: [],
        existingCode: "",
        constraints: ["No any types", "No TODOs or stubs", "Complete implementations only"],
      }).pipe(Effect.provide(provider)),
    );

    console.log(`Status: ${implResult.status}`);
    console.log(`Root files: ${implResult.data.files.length}`);
    console.log(`Root gates: all pass = ${implResult.data.allGatesPass}`);
    for (const g of implResult.data.gateResults) {
      console.log(`  ${g.passed ? "PASS" : "FAIL"}: ${g.gate} — ${g.detail}`);
    }

    console.log(`\nChild implementations: ${implResult.data.childImplementations.length}`);
    let totalChildFiles = 0;
    let childGatesFailed = 0;
    for (const child of implResult.data.childImplementations) {
      totalChildFiles += child.files.length;
      if (!child.allGatesPass) childGatesFailed++;
      console.log(`  ${child.path}: ${child.files.length} files, gates pass = ${child.allGatesPass}`);
      for (const g of child.gateResults) {
        if (!g.passed) console.log(`    FAIL: ${g.gate} — ${g.detail}`);
      }
    }

    console.log(`\nTotal files: ${implResult.data.files.length + totalChildFiles} (root: ${implResult.data.files.length}, children: ${totalChildFiles})`);
    console.log(`Tokens: ${implResult.cost.tokens}, Cost: $${implResult.cost.usd.toFixed(4)}`);

    const allGates = [
      ...implResult.data.gateResults,
      ...implResult.data.childImplementations.flatMap((c) => c.gateResults),
    ];
    const gatePassRate = allGates.length > 0
      ? allGates.filter((g) => g.passed).length / allGates.length
      : 0;
    const composite = computeImplementScore(gatePassRate, 3.0);
    console.log(`Aggregate gate pass rate: ${(gatePassRate * 100).toFixed(0)}%, Composite: ${(composite * 100).toFixed(1)}%`);

    persistResult("recursive-implement-synthetic", {
      condition: "recursive-implement-synthetic",
      task: "bridge-synthetic-5-children",
      tokens: implResult.cost.tokens,
      cost_usd: implResult.cost.usd,
      duration_ms: implResult.cost.duration_ms,
      rootFiles: implResult.data.files.length,
      childImplementations: implResult.data.childImplementations.map((c) => ({
        path: c.path, files: c.files.length, allGatesPass: c.allGatesPass,
        gateResults: c.gateResults,
      })),
      totalFiles: implResult.data.files.length + totalChildFiles,
      gateResults: allGates,
      gatePassRate,
      allGatesPass: implResult.data.allGatesPass && implResult.data.childImplementations.every((c) => c.allGatesPass),
      compositeScore: composite,
    });

    expect(implResult.data.childImplementations.length).toBeGreaterThanOrEqual(3);
    console.log(`\nH2: recursive ${(gatePassRate * 100).toFixed(0)}% gates across ${implResult.data.childImplementations.length} child domains`);
  }, 900000); // 15 min — 5 concurrent children with potential retries
});
