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
import { designLevel, type DesignOutput } from "../algorithms/design.js";
import { implementLevel } from "../algorithms/implement.js";
import { designJudge, computeDesignScore } from "../algorithms/design-judge.js";
import { runGates, type FileArtifact } from "../algorithms/gate-runner.js";
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
});
