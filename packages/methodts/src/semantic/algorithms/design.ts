// SPDX-License-Identifier: Apache-2.0
/**
 * design — FCA-recursive surface-first design algorithm.
 *
 * Implements the fcd-design skill as an SPL program:
 *   1. At each FCA level, write documentation AS IF the component is already
 *      implemented (labeled DRAFT) — the design artifact IS the documentation
 *   2. Define typed ports to sub-components (Tier 1: definitional)
 *   3. Mock sub-component architecture (Tier 2: structural skeleton)
 *   4. Spawn sub-agents for each sub-component (recurse)
 *   5. Collect and verify composition
 *
 * The key FCD inversion: surfaces (ports) are the main deliverable.
 * Architecture follows from frozen ports, not the other way around.
 *
 * @see fcd-design SKILL.md — Phase 2 (domains), Phase 3 (surfaces), Phase 4 (architecture)
 * @see fca/advice/03-recursive-semantic-algorithms.md — Design algorithm
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { SemanticFn } from "../fn.js";
import { recurse } from "../compose.js";
import type { FsLoader } from "./fs-loader.js";

// ── Types ──

/** A port definition between two components. */
export type PortDefinition = {
  readonly name: string;
  readonly owner: string;        // Which component owns the interface
  readonly consumer: string;     // Which component consumes it
  readonly description: string;  // What flows across
  readonly methods: string;      // TypeScript interface sketch
};

/** A sub-component identified during design. */
export type SubComponentSpec = {
  readonly name: string;
  readonly path: string;
  readonly level: number;
  readonly purpose: string;
  readonly ports: readonly PortDefinition[];
};

/** Input to the design function at each level. */
export type DesignInput = {
  /** What we're designing — the requirement or feature description. */
  readonly requirement: string;
  /** Path to the component being designed. */
  readonly path: string;
  /** FCA level. */
  readonly level: number;
  /** Existing documentation at this level (may be empty for new components). */
  readonly existingDocs: string;
  /** Existing children (sub-components already present). */
  readonly existingChildren: readonly string[];
  /** Constraints inherited from parent (invariants threading down). */
  readonly constraints: readonly string[];
};

/** Output from the design function at each level. */
export type DesignOutput = {
  /** Path of the designed component. */
  readonly path: string;
  /** FCA level. */
  readonly level: number;
  /** Draft documentation — as if the component is already implemented. */
  readonly draftDocumentation: string;
  /** Ports defined at this level (the main deliverable). */
  readonly ports: readonly PortDefinition[];
  /** Actual TypeScript code for port interface files (enables tsc gate check). */
  readonly portFileContent: string;
  /** Actual markdown for the README (enables doc quality checks). */
  readonly readmeContent: string;
  /** Sub-components identified for recursion. */
  readonly subComponents: readonly SubComponentSpec[];
  /** Architecture notes (brief — implementation details follow from ports). */
  readonly architectureNotes: string;
  /** Child design results (populated by recursion). */
  readonly childDesigns: readonly DesignOutput[];
};

// ── Prompt ──

const designPrompt = new Prompt<DesignInput>((input) => {
  const levelName = ["Function", "Module", "Domain", "Package", "Service", "System"][input.level] ?? `L${input.level}`;

  return `Design L${input.level} ${levelName} component at ${input.path}

REQUIREMENT: ${input.requirement}

EXISTING DOCS:
${input.existingDocs || "(new component — no existing docs)"}

EXISTING CHILDREN:
${input.existingChildren.length > 0 ? input.existingChildren.join(", ") : "(none)"}

CONSTRAINTS:
${input.constraints.length > 0 ? input.constraints.map((c) => `- ${c}`).join("\n") : "(none)"}

INSTRUCTIONS — Surface-First Design (FCD):
1. Write DRAFT documentation as if this component is already implemented.
   Describe what it does, what it exposes, what it depends on.
2. Define PORTS — typed interfaces for cross-component communication.
   Ports are the PRIMARY deliverable. Each port needs: name, owner, consumer, description, TypeScript interface sketch.
3. Identify SUB-COMPONENTS that should be designed at the next level down.
   Each sub-component gets: name, purpose, and which ports it participates in.
4. Brief ARCHITECTURE notes (how sub-components compose — but keep it brief, ports matter more).

You MUST use this EXACT format. No markdown headings, no bold, no variations.

DOCUMENTATION:
<draft docs as if already implemented — 5-15 lines>

PORTS:
PORT <name>
owner: <component>
consumer: <component>
description: <what flows>
interface: <TypeScript interface sketch, 2-5 lines>
END_PORT

(repeat for each port, or "PORTS: (none)" if no cross-component surfaces needed)

SUB_COMPONENTS:
- <name> | <purpose> | ports: <comma-separated port names>

(repeat for each sub-component, or "SUB_COMPONENTS: (none)" if this is a leaf)

ARCHITECTURE:
<1-3 sentences on how sub-components compose>

EXAMPLE (abbreviated):

DOCUMENTATION:
A session orchestration server managing agent sessions, methodology execution, and strategy pipelines.
All cross-domain communication through typed port interfaces.

PORTS:
PORT EventBus
owner: infrastructure
consumer: sessions, strategies
description: Universal event backbone for domain coordination
interface: export interface EventBus {
  emit(event: BridgeEventInput): BridgeEvent;
  subscribe(filter: EventFilter, handler: (event: BridgeEvent) => void): EventSubscription;
}
END_PORT

SUB_COMPONENTS:
- sessions | Agent session lifecycle and pool management | ports: EventBus, SessionPool
- strategies | Strategy pipeline execution engine | ports: EventBus, SessionPool

ARCHITECTURE:
Composition root creates port implementations and injects them into domain services.`;
});

// ── Parser ──

function parseDesignOutput(raw: string, input: DesignInput): DesignOutput | null {
  // Normalize markdown formatting variations from LLMs:
  //   "## DOCUMENTATION" → "DOCUMENTATION:", "**PORT Foo**" → "PORT Foo", etc.
  const normalized = raw
    .replace(/^#{1,3}\s*/gm, "")               // strip heading markers
    .replace(/^\*\*([A-Z_]+(?:\s*[A-Z_]+)*):?\*\*:?\s*$/gm, "$1:") // **SECTION:** → SECTION:
    .replace(/\*\*(PORT\s+\S+)\*\*/g, "$1")     // **PORT Foo** → PORT Foo
    .replace(/\*\*(END_PORT)\*\*/g, "$1")        // **END_PORT** → END_PORT
    .replace(/^-\s+(owner|consumer|description|interface):/gm, "$1:") // - owner: → owner:
    .replace(/^---+\s*$/gm, "");               // strip horizontal rules

  // Normalize section headers to canonical uppercase form
  const withSections = normalized
    .replace(/\bsub[_\s-]?components?\b:?/gi, "SUB_COMPONENTS:")
    .replace(/\bdocumentation\b:?/gi, "DOCUMENTATION:")
    .replace(/\bports\b:?/gi, "PORTS:")
    .replace(/\barchitecture\b:?/gi, "ARCHITECTURE:")
    // Undo over-normalization inside port blocks (restore "ports:" in sub-component lines and port blocks)
    .replace(/^([-*]\s*.+\|\s*.+\|\s*)PORTS:\s*/gm, "$1ports: ")
    .replace(/^([-*]\s*.+[—–-].+?)PORTS:\s*/gm, "$1ports: ");

  const docMatch = withSections.match(/DOCUMENTATION:\s*\n([\s\S]*?)(?=\nPORTS:)/);
  if (!docMatch) return null;

  const draftDocumentation = docMatch[1].trim();

  // Parse ports — handle both plain and code-fenced interface blocks
  const ports: PortDefinition[] = [];
  const portRegex = /PORT\s+(\S+)\s*\n\s*owner:\s*(.+)\n\s*consumer:\s*(.+)\n\s*description:\s*(.+)\n\s*interface:\s*([\s\S]*?)END_PORT/g;
  let portMatch;
  while ((portMatch = portRegex.exec(withSections)) !== null) {
    // Strip code fences from interface block if present
    const methods = portMatch[5].trim()
      .replace(/^```(?:typescript|ts)?\s*\n?/gm, "")
      .replace(/^```\s*$/gm, "")
      .trim();
    ports.push({
      name: portMatch[1].trim(),
      owner: portMatch[2].trim(),
      consumer: portMatch[3].trim(),
      description: portMatch[4].trim(),
      methods,
    });
  }

  // Parse sub-components — try strict format first, then fallback patterns
  const subComponents: SubComponentSpec[] = [];
  const subMatch = withSections.match(/SUB_COMPONENTS:\s*\n([\s\S]*?)(?=\nARCHITECTURE:|\s*$)/);
  if (subMatch && !subMatch[1].includes("(none)")) {
    const lines = subMatch[1].trim().split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      // Pattern 1 (standard): "- name | purpose | ports: ..."
      const p1 = line.match(/^[-*]\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(.+?)\s*\|\s*ports?:\s*(.*)$/);
      // Pattern 2 (dash-separated): "- name — purpose. Ports: ..." or "- name - purpose (ports: ...)"
      const p2 = !p1 ? line.match(/^[-*]\s*\*{0,2}(.+?)\*{0,2}\s*[—–-]\s*(.+?)(?:\.\s*|\s+)(?:ports?:\s*|PORTS:\s*|\(ports?:\s*)(.+?)\)?\s*$/) : null;
      // Pattern 3 (numbered): "1. name | purpose | ports: ..."
      const p3 = !p1 && !p2 ? line.match(/^\d+\.\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(.+?)\s*\|\s*ports?:\s*(.*)$/) : null;
      // Pattern 4 (minimal): "- name | purpose" (no ports listed — use empty)
      const p4 = !p1 && !p2 && !p3 ? line.match(/^[-*]\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(.+?)$/) : null;

      const match = p1 || p2 || p3;
      if (match) {
        const name = match[1].trim();
        const componentPorts = match[3].trim().split(/[,;]/).map((p) => p.trim()).filter(Boolean)
          .map((p) => p.replace(/\s*\(.*?\)\s*$/, "").trim());
        subComponents.push({
          name,
          path: `${input.path}/${name}`,
          level: input.level - 1,
          purpose: match[2].trim(),
          ports: ports.filter((p) => componentPorts.includes(p.name)),
        });
      } else if (p4) {
        subComponents.push({
          name: p4[1].trim(),
          path: `${input.path}/${p4[1].trim()}`,
          level: input.level - 1,
          purpose: p4[2].trim(),
          ports: [],
        });
      }
    }
  }

  // Parse architecture notes
  const archMatch = withSections.match(/ARCHITECTURE:\s*\n([\s\S]*?)$/);
  const architectureNotes = archMatch ? archMatch[1].trim() : "";

  // Generate portFileContent — actual TypeScript for port interfaces
  const portFileContent = ports.length > 0
    ? ports.map((p) =>
        `/**\n * ${p.name} — ${p.description}\n * Owner: ${p.owner} | Consumer: ${p.consumer}\n */\n${p.methods}`,
      ).join("\n\n")
    : "";

  // Generate readmeContent — the draft docs as markdown
  const readmeContent = `# ${input.path.split("/").pop() ?? "Component"}\n\n> DRAFT — designed but not yet implemented\n\n${draftDocumentation}`;

  return {
    path: input.path,
    level: input.level,
    draftDocumentation,
    ports,
    portFileContent,
    readmeContent,
    subComponents,
    architectureNotes,
    childDesigns: [],
  };
}

// ── The Semantic Function ──

/** Design a single level — write docs, define ports, identify sub-components. */
export const designLevel: SemanticFn<DesignInput, DesignOutput> = semanticFn({
  name: "design-level",
  prompt: designPrompt,
  parse: parseDesignOutput,
  pre: [
    check("requirement is non-empty", (i: DesignInput) => i.requirement.length > 0),
    check("path is non-empty", (i: DesignInput) => i.path.length > 0),
  ],
  post: [
    check("draft documentation produced", (o: DesignOutput) => o.draftDocumentation.length > 0),
    // Ports are the main deliverable — but leaf components may have none
  ],
  maxRetries: 1,
});

/**
 * The full recursive design algorithm (static decompose — no filesystem).
 *
 * Child inputs get empty existingDocs and existingChildren.
 * Use `createDesignWithFs(fsLoader)` for filesystem-populated children.
 */
export const design: SemanticFn<DesignInput, DesignOutput> = recurse(
  designLevel,
  (output: DesignOutput, input: DesignInput) =>
    output.subComponents.map((sub) => ({
      requirement: input.requirement,
      path: sub.path,
      level: sub.level,
      existingDocs: "",
      existingChildren: [],
      constraints: [
        ...input.constraints,
        ...sub.ports.map((p) => `Port ${p.name}: ${p.description}`),
      ],
    })),
  (own: DesignOutput, children: DesignOutput[]) => ({
    ...own,
    childDesigns: children,
  }),
  (input: DesignInput) => input.level <= 0,
);

/**
 * Create a recursive design algorithm with filesystem-populated child inputs.
 *
 * The FsLoader is injected into the decompose closure so children get real
 * documentation and child lists from the filesystem. This is the version
 * to use for real execution (not deterministic tests).
 */
export function createDesignWithFs(fs: FsLoader): SemanticFn<DesignInput, DesignOutput> {
  return recurse(
    designLevel,
    // Decompose: populate child inputs from filesystem via FsLoader
    (output: DesignOutput, input: DesignInput) =>
      output.subComponents.map((sub) => {
        const childDocs = fs.exists(sub.path) ? readDocFromFs(fs, sub.path, sub.level) : "";
        const childChildren = fs.exists(sub.path) ? listChildrenFromFs(fs, sub.path, sub.level) : [];
        return {
          requirement: input.requirement,
          path: sub.path,
          level: sub.level,
          existingDocs: childDocs,
          existingChildren: childChildren,
          constraints: [
            ...input.constraints,
            ...sub.ports.map((p) => `Port ${p.name}: ${p.description}`),
          ],
        };
      }),
    (own: DesignOutput, children: DesignOutput[]) => ({
      ...own,
      childDesigns: children,
    }),
    (input: DesignInput) => input.level <= 0,
  );
}

// ── Helpers for FsLoader integration ──

function readDocFromFs(fs: FsLoader, path: string, level: number): string {
  const parts: string[] = [];
  const readmePath = `${path}/README.md`;
  if (fs.exists(readmePath)) {
    const content = fs.readFile(readmePath);
    if (content) parts.push(content.slice(0, 1000));
  }
  if (level <= 2) {
    const indexPath = `${path}/index.ts`;
    if (fs.exists(indexPath)) {
      const content = fs.readFile(indexPath);
      const exports = content.split("\n").filter((l) => l.startsWith("export")).slice(0, 20);
      if (exports.length > 0) parts.push(`Exports:\n${exports.join("\n")}`);
    }
  }
  return parts.join("\n\n") || "";
}

function listChildrenFromFs(fs: FsLoader, path: string, level: number): string[] {
  if (!fs.exists(path)) return [];
  const entries = fs.readDir(path);
  const exclude = new Set(["node_modules", ".git", "dist", "build", "__tests__", "coverage"]);
  return entries
    .filter((e) => !e.startsWith(".") && !exclude.has(e))
    .filter((e) => {
      if (fs.isDirectory(`${path}/${e}`)) return true;
      if (level <= 1 && e.endsWith(".ts") && !e.endsWith(".test.ts") && !e.endsWith(".d.ts")) return true;
      return false;
    })
    .sort();
}
