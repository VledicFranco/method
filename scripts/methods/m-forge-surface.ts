/**
 * M-FORGE-SURFACE — Port Interface Co-Design Method
 *
 * A 7-step method that executes the forge-surface ritual as a formal
 * method with typed state, postconditions, and artifact production.
 *
 * Steps:
 *   sigma_0  Initialize        (script)  — validate domains, scan existing ports
 *   sigma_1  Name & Scope      (agent)   — surfaceName, direction, dataFlowDesc
 *   sigma_2  Define Interface  (agent)   — typeDefinitions, interfaceDefinition
 *   sigma_3  Producers         (agent)   — producer, consumer, injectionPath
 *   sigma_4  Freeze Contract   (script)  — frozen = true
 *   sigma_5  Gate Assertion    (agent)   — gateAssertion TypeScript type-check
 *   sigma_6  Produce Artifacts (script)  — write .port.ts + .record.yaml
 *
 * Axiom: domainA !== domainB
 */

import { Effect } from "effect";
import { Prompt } from "../../packages/methodts/src/prompt/prompt.js";
import { check } from "../../packages/methodts/src/predicate/predicate.js";
import type { Method } from "../../packages/methodts/src/index.js";
import type { StepError } from "../../packages/methodts/src/method/step.js";

// ── State ─────────────────────────────────────────────────────────────────────

export type ForgeSurfaceState = {
  readonly domainA: string;
  readonly domainB: string;
  readonly direction: "A->B" | "B->A" | "bidirectional" | null;
  readonly surfaceHint: string | null;
  readonly domainAExists: boolean;
  readonly domainBExists: boolean;
  readonly existingPorts: readonly { name: string; file: string }[];
  readonly surfaceName: string;
  readonly dataFlowDesc: string;
  readonly syncNature: "sync" | "async" | "event-driven" | null;
  readonly logicalOwner: string;
  readonly typeDefinitions: string;
  readonly interfaceDefinition: string;
  readonly producer: string;
  readonly consumer: string;
  readonly injectionPath: string;
  readonly frozen: boolean;
  readonly gateAssertion: string;
  readonly coDesignRecordPath: string;
  readonly portFilePath: string;
  readonly artifactsWritten: boolean;
};

export type InitialForgeSurfaceState = {
  domainA: string;
  domainB: string;
  surfaceHint?: string;
};

export function makeInitialState(opts: InitialForgeSurfaceState): ForgeSurfaceState {
  return {
    domainA: opts.domainA,
    domainB: opts.domainB,
    direction: null,
    surfaceHint: opts.surfaceHint ?? null,
    domainAExists: false,
    domainBExists: false,
    existingPorts: [],
    surfaceName: "",
    dataFlowDesc: "",
    syncNature: null,
    logicalOwner: "",
    typeDefinitions: "",
    interfaceDefinition: "",
    producer: "",
    consumer: "",
    injectionPath: "",
    frozen: false,
    gateAssertion: "",
    coDesignRecordPath: "",
    portFilePath: "",
    artifactsWritten: false,
  };
}

// ── JSON extraction helper ─────────────────────────────────────────────────────

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim();
  // Try 1: raw JSON
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { /* fall through */ }
  // Try 2: ```json ... ``` code block
  const blockMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Try 3: first { ... } found in text
  const braceMatch = cleaned.match(/\{[\s\S]+\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return null;
}

// ── Method ────────────────────────────────────────────────────────────────────

type AgentCtx = {
  state: ForgeSurfaceState;
  world: Record<string, string>;
  insights: Record<string, string>;
  domainFacts: string;
};

const BRIDGE_DOMAINS_DIR = "packages/bridge/src/domains";
const BRIDGE_PORTS_DIR = "packages/bridge/src/ports";

export const M_FORGE_SURFACE: Method<ForgeSurfaceState> = {
  id: "M-FORGE-SURFACE",
  name: "Forge Surface — Port Interface Co-Design",

  domain: {
    id: "D_FORGE_SURFACE",
    signature: {
      sorts: [
        { name: "Domain", description: "FCA domain identifier", cardinality: "finite" },
        { name: "Port",   description: "Port interface definition", cardinality: "singleton" },
      ],
      functionSymbols: [],
      predicates: {
        domains_exist:       check<ForgeSurfaceState>("domains_exist",       (s) => s.domainAExists && s.domainBExists),
        surface_named:       check<ForgeSurfaceState>("surface_named",       (s) => s.surfaceName.length > 0 && s.direction !== null),
        interface_defined:   check<ForgeSurfaceState>("interface_defined",   (s) => s.interfaceDefinition.length > 0),
        producers_assigned:  check<ForgeSurfaceState>("producers_assigned",  (s) => s.producer.length > 0 && s.consumer.length > 0),
        contract_frozen:     check<ForgeSurfaceState>("contract_frozen",     (s) => s.frozen),
        gate_written:        check<ForgeSurfaceState>("gate_written",        (s) => s.gateAssertion.length > 0),
        artifacts_written:   check<ForgeSurfaceState>("artifacts_written",   (s) => s.artifactsWritten),
      },
    },
    axioms: {
      domains_must_be_distinct: check<ForgeSurfaceState>(
        "domains_must_be_distinct",
        (s) => s.domainA !== s.domainB,
      ),
    },
  },

  roles: [
    {
      id: "architect",
      description: "Designs port interfaces between FCA domains.",
      observe: (s) => s,
      authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4", "sigma_5", "sigma_6"],
      notAuthorized: [],
    },
  ],

  dag: {
    steps: [
      // ── sigma_0: Initialize (script) ────────────────────────────────────────
      {
        id: "sigma_0",
        name: "Initialize",
        role: "architect",
        precondition: check("domains_distinct", (s: ForgeSurfaceState) => s.domainA !== s.domainB),
        postcondition: check("domains_exist",   (s: ForgeSurfaceState) => s.domainAExists && s.domainBExists),
        execution: {
          tag: "script",
          execute: (s) =>
            Effect.tryPromise({
              try: async () => {
                const { existsSync, readdirSync } = await import("fs");
                const { resolve } = await import("path");

                const domainAPath = resolve(BRIDGE_DOMAINS_DIR, s.domainA);
                const domainBPath = resolve(BRIDGE_DOMAINS_DIR, s.domainB);
                const portsPath   = resolve(BRIDGE_PORTS_DIR);

                const domainAExists = existsSync(domainAPath);
                const domainBExists = existsSync(domainBPath);

                const existingPorts: { name: string; file: string }[] = [];
                if (existsSync(portsPath)) {
                  for (const f of readdirSync(portsPath).filter(f => f.endsWith(".ts"))) {
                    existingPorts.push({ name: f.replace(".ts", ""), file: `${BRIDGE_PORTS_DIR}/${f}` });
                  }
                }

                return { ...s, domainAExists, domainBExists, existingPorts };
              },
              catch: (e): StepError => ({ _tag: "StepError", stepId: "sigma_0", message: String(e) }),
            }),
        },
      },

      // ── sigma_1: Name & Scope (agent) ────────────────────────────────────────
      {
        id: "sigma_1",
        name: "Name & Scope",
        role: "architect",
        precondition: check("domains_exist",  (s: ForgeSurfaceState) => s.domainAExists && s.domainBExists),
        postcondition: check("surface_named", (s: ForgeSurfaceState) => s.surfaceName.length > 0 && s.direction !== null),
        execution: {
          tag: "agent",
          role: "architect",
          context: {},
          prompt: new Prompt<AgentCtx>((ctx) => {
            const s = ctx.state;
            const hint = s.surfaceHint ? `\nAdditional context: ${s.surfaceHint}` : "";
            const ports = s.existingPorts.length > 0
              ? `\nExisting ports already in the codebase: ${s.existingPorts.map(p => p.name).join(", ")}`
              : "\nNo existing ports yet.";
            return `You are a software architect working in a Fractal Component Architecture (FCA) codebase.

Domain A: ${s.domainA}
Domain B: ${s.domainB}${hint}${ports}

In FCA, domains communicate only through typed port interfaces. A port defines a contract that one domain implements and another consumes. Ports live in packages/bridge/src/ports/.

Task: Name the port interface between these domains and define the data flow direction.

Naming rules: PascalCase, ends with Port/Source/Sink. Should clearly describe the relationship.
Direction options: "A->B" (${s.domainA} provides to ${s.domainB}), "B->A" (${s.domainB} provides to ${s.domainA}), "bidirectional".

Respond with ONLY valid JSON (no explanation, no markdown):
{
  "surfaceName": "<PortName>",
  "direction": "<A->B|B->A|bidirectional>",
  "dataFlowDesc": "<one sentence: what data flows across this surface and why>",
  "logicalOwner": "<which domain owns/defines this port: ${s.domainA} or ${s.domainB}>"
}`;
          }),
          parse: (raw, current) => {
            const data = extractJson(raw);
            if (!data) return Effect.fail({ _tag: "ParseError" as const, message: `No JSON found in: ${raw.slice(0, 200)}` });
            const surfaceName  = String(data.surfaceName  ?? "");
            const direction    = data.direction as ForgeSurfaceState["direction"];
            const dataFlowDesc = String(data.dataFlowDesc ?? "");
            const logicalOwner = String(data.logicalOwner ?? "");
            if (!surfaceName) return Effect.fail({ _tag: "ParseError" as const, message: "surfaceName missing" });
            if (!direction)   return Effect.fail({ _tag: "ParseError" as const, message: "direction missing" });
            return Effect.succeed({ ...current, surfaceName, direction, dataFlowDesc, logicalOwner });
          },
        },
      },

      // ── sigma_2: Define Interface (agent) ────────────────────────────────────
      {
        id: "sigma_2",
        name: "Define Interface",
        role: "architect",
        precondition: check("surface_named",    (s: ForgeSurfaceState) => s.surfaceName.length > 0),
        postcondition: check("interface_defined",(s: ForgeSurfaceState) => s.interfaceDefinition.length > 0),
        execution: {
          tag: "agent",
          role: "architect",
          context: {},
          prompt: new Prompt<AgentCtx>((ctx) => {
            const s = ctx.state;
            const dirLabel =
              s.direction === "A->B" ? `${s.domainA} → ${s.domainB}` :
              s.direction === "B->A" ? `${s.domainB} → ${s.domainA}` :
              `${s.domainA} ↔ ${s.domainB}`;
            return `You are defining a TypeScript port interface for an FCA codebase.

Port name: ${s.surfaceName}
Flow: ${dirLabel}
Description: ${s.dataFlowDesc}
Owner domain: ${s.logicalOwner}

Write a minimal TypeScript port interface. Only include operations truly needed for this surface. Use Promise<T> returns for async operations. No imports needed — use primitives and inline types only.

Respond with ONLY valid JSON (no explanation, no markdown):
{
  "typeDefinitions": "<TypeScript type aliases as a single string, newlines as \\n — empty string if none>",
  "interfaceDefinition": "<complete TypeScript interface block as a single string, newlines as \\n>",
  "syncNature": "<sync|async|event-driven>"
}`;
          }),
          parse: (raw, current) => {
            const data = extractJson(raw);
            if (!data) return Effect.fail({ _tag: "ParseError" as const, message: `No JSON found in: ${raw.slice(0, 200)}` });
            const typeDefinitions   = String(data.typeDefinitions   ?? "");
            const interfaceDefinition = String(data.interfaceDefinition ?? "");
            const syncNature        = (data.syncNature ?? "sync") as ForgeSurfaceState["syncNature"];
            if (!interfaceDefinition) return Effect.fail({ _tag: "ParseError" as const, message: "interfaceDefinition missing" });
            return Effect.succeed({ ...current, typeDefinitions, interfaceDefinition, syncNature });
          },
        },
      },

      // ── sigma_3: Producers & Consumers (agent) ───────────────────────────────
      {
        id: "sigma_3",
        name: "Producers & Consumers",
        role: "architect",
        precondition: check("interface_defined",  (s: ForgeSurfaceState) => s.interfaceDefinition.length > 0),
        postcondition: check("producers_assigned", (s: ForgeSurfaceState) => s.producer.length > 0 && s.consumer.length > 0),
        execution: {
          tag: "agent",
          role: "architect",
          context: {},
          prompt: new Prompt<AgentCtx>((ctx) => {
            const s = ctx.state;
            return `You are finalizing dependency injection for a port interface in an FCA Node.js application.

Port: ${s.surfaceName}
Interface:
${s.interfaceDefinition}

Domain A: ${s.domainA}
Domain B: ${s.domainB}
Data flow: ${s.dataFlowDesc}
Owner: ${s.logicalOwner}

In FCA, one domain implements the port (producer) and another depends on it (consumer). Both are wired at the composition root (server-entry.ts).

Respond with ONLY valid JSON (no explanation, no markdown):
{
  "producer": "<class or object name in ${s.logicalOwner} that implements ${s.surfaceName}>",
  "consumer": "<domain or class that depends on ${s.surfaceName}>",
  "injectionPath": "<one sentence: how the port is injected at server-entry.ts>"
}`;
          }),
          parse: (raw, current) => {
            const data = extractJson(raw);
            if (!data) return Effect.fail({ _tag: "ParseError" as const, message: `No JSON found in: ${raw.slice(0, 200)}` });
            const producer      = String(data.producer      ?? "");
            const consumer      = String(data.consumer      ?? "");
            const injectionPath = String(data.injectionPath ?? "");
            if (!producer) return Effect.fail({ _tag: "ParseError" as const, message: "producer missing" });
            if (!consumer) return Effect.fail({ _tag: "ParseError" as const, message: "consumer missing" });
            return Effect.succeed({ ...current, producer, consumer, injectionPath });
          },
        },
      },

      // ── sigma_4: Freeze Contract (script) ────────────────────────────────────
      {
        id: "sigma_4",
        name: "Freeze Contract",
        role: "architect",
        precondition: check("producers_assigned", (s: ForgeSurfaceState) => s.producer.length > 0 && s.consumer.length > 0),
        postcondition: check("contract_frozen",   (s: ForgeSurfaceState) => s.frozen),
        execution: {
          tag: "script",
          execute: (s) => Effect.succeed({ ...s, frozen: true }),
        },
      },

      // ── sigma_5: Write Gate Assertion (agent) ────────────────────────────────
      {
        id: "sigma_5",
        name: "Write Gate Assertion",
        role: "architect",
        precondition: check("contract_frozen", (s: ForgeSurfaceState) => s.frozen),
        postcondition: check("gate_written",   (s: ForgeSurfaceState) => s.gateAssertion.length > 0),
        execution: {
          tag: "agent",
          role: "architect",
          context: {},
          prompt: new Prompt<AgentCtx>((ctx) => {
            const s = ctx.state;
            return `Write a TypeScript architecture gate assertion for port ${s.surfaceName}.

The interface is:
${s.interfaceDefinition}

The gate assertion should be a TypeScript file that:
1. Imports the interface (assume path: "../../ports/${s.surfaceName.charAt(0).toLowerCase() + s.surfaceName.slice(1)}.js")
2. Uses a type-level check to verify the interface compiles correctly
3. Pattern: declare a variable typed as the interface (compile-time check, no runtime logic)

Example:
  import type { FooPort } from "../../ports/fooPort.js";
  // Type gate — this file must compile cleanly
  declare const _gate: FooPort;

Respond with ONLY valid JSON (no explanation, no markdown):
{
  "gateAssertion": "<complete TypeScript file content — escape newlines as \\n>"
}`;
          }),
          parse: (raw, current) => {
            const data = extractJson(raw);
            if (!data) return Effect.fail({ _tag: "ParseError" as const, message: `No JSON found in: ${raw.slice(0, 200)}` });
            const gateAssertion = String(data.gateAssertion ?? "");
            if (!gateAssertion) return Effect.fail({ _tag: "ParseError" as const, message: "gateAssertion missing" });
            // Unescape \n sequences so we get real newlines in the file
            const unescaped = gateAssertion.replace(/\\n/g, "\n").replace(/\\t/g, "  ");
            return Effect.succeed({ ...current, gateAssertion: unescaped });
          },
        },
      },

      // ── sigma_6: Produce Artifacts (script) ──────────────────────────────────
      {
        id: "sigma_6",
        name: "Produce Artifacts",
        role: "architect",
        precondition: check("gate_written",      (s: ForgeSurfaceState) => s.gateAssertion.length > 0),
        postcondition: check("artifacts_written", (s: ForgeSurfaceState) => s.artifactsWritten),
        execution: {
          tag: "script",
          execute: (s) =>
            Effect.tryPromise({
              try: async () => {
                const { mkdirSync, writeFileSync } = await import("fs");
                const { resolve }                  = await import("path");

                const outputDir = resolve("scripts/output/forge-surface");
                mkdirSync(outputDir, { recursive: true });

                const slug = `${s.domainA}-${s.domainB}-${s.surfaceName.toLowerCase()}`;
                const portFile   = resolve(outputDir, `${slug}.port.ts`);
                const recordFile = resolve(outputDir, `${slug}.record.yaml`);
                const gateFile   = resolve(outputDir, `${slug}.gate.ts`);

                // Port interface file
                const portContent = [
                  `/**`,
                  ` * ${s.surfaceName} — Port interface between ${s.domainA} and ${s.domainB}.`,
                  ` *`,
                  ` * Generated by M-FORGE-SURFACE.`,
                  ` * Flow: ${s.dataFlowDesc}`,
                  ` */`,
                  "",
                  s.typeDefinitions || null,
                  s.typeDefinitions ? "" : null,
                  s.interfaceDefinition,
                  "",
                ].filter(l => l !== null).join("\n");

                writeFileSync(portFile, portContent, "utf-8");

                // Gate assertion file
                writeFileSync(gateFile, s.gateAssertion, "utf-8");

                // Co-design record (YAML)
                const record = [
                  `# Co-Design Record — ${s.surfaceName}`,
                  `port: ${s.surfaceName}`,
                  `domain_a: ${s.domainA}`,
                  `domain_b: ${s.domainB}`,
                  `direction: ${s.direction}`,
                  `logical_owner: ${s.logicalOwner}`,
                  `data_flow: "${s.dataFlowDesc}"`,
                  `sync_nature: ${s.syncNature ?? "sync"}`,
                  `producer: ${s.producer}`,
                  `consumer: ${s.consumer}`,
                  `injection_path: "${s.injectionPath}"`,
                  `frozen: ${s.frozen}`,
                  `port_file: ${portFile.replace(/\\/g, "/")}`,
                  `gate_file: ${gateFile.replace(/\\/g, "/")}`,
                  `generated_at: ${new Date().toISOString()}`,
                ].join("\n");

                writeFileSync(recordFile, record, "utf-8");

                return { ...s, portFilePath: portFile, coDesignRecordPath: recordFile, artifactsWritten: true };
              },
              catch: (e): StepError => ({ _tag: "StepError", stepId: "sigma_6", message: String(e) }),
            }),
        },
      },
    ],

    edges: [
      { from: "sigma_0", to: "sigma_1" },
      { from: "sigma_1", to: "sigma_2" },
      { from: "sigma_2", to: "sigma_3" },
      { from: "sigma_3", to: "sigma_4" },
      { from: "sigma_4", to: "sigma_5" },
      { from: "sigma_5", to: "sigma_6" },
    ],
    initial: "sigma_0",
    terminal: "sigma_6",
  },

  objective: check("forge_complete", (s: ForgeSurfaceState) =>
    s.artifactsWritten && s.frozen && s.gateAssertion.length > 0,
  ),

  measures: [
    {
      id: "mu_completeness",
      name: "Completeness",
      compute: (s: ForgeSurfaceState) => {
        let score = 0;
        if (s.domainAExists && s.domainBExists)   score++;
        if (s.surfaceName)                         score++;
        if (s.interfaceDefinition)                 score++;
        if (s.producer && s.consumer)              score++;
        if (s.frozen)                              score++;
        if (s.gateAssertion)                       score++;
        if (s.artifactsWritten)                    score++;
        return score / 7;
      },
      range: [0, 1],
      terminal: 1,
    },
  ],
};
