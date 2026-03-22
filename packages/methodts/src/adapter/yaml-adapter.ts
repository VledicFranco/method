/**
 * YAML Adapter — loads registry YAML into typed MethodTS values.
 *
 * Bridges the YAML-based methodology registry with the typed SDK.
 * Converts raw YAML structures (parsed by js-yaml) into fully typed
 * Method<S>, Methodology<S>, DomainTheory<S>, Step<S>, Role<S>, and Arm<S>.
 *
 * State type S = Record<string, unknown> for YAML-loaded values (untyped world state).
 */

import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Effect } from "effect";
import type { Method } from "../method/method.js";
import type { Methodology, Arm, SafetyBounds, TerminationCertificate } from "../methodology/methodology.js";
import type { DomainTheory, SortDecl, FunctionDecl } from "../domain/domain-theory.js";
import type { Step, StepExecution } from "../method/step.js";
import type { StepDAG, StepEdge } from "../method/dag.js";
import type { Role } from "../domain/role.js";
import type { Measure } from "../method/measure.js";
import { TRUE } from "../predicate/predicate.js";
import { Prompt } from "../prompt/prompt.js";
import { parsePredicate, parseReturns } from "./predicate-parser.js";
import type { YamlMethod, YamlMethodology, YamlDomainTheory, YamlPhase, YamlRole, YamlArm } from "./yaml-types.js";

// ── State type alias for YAML-loaded values ──

type S = Record<string, unknown>;

// ── Public API ──

/** Load a YAML string and convert to MethodTS Method. */
export function loadMethodFromYamlString(yamlStr: string): Method<S> {
  const raw = yaml.load(yamlStr) as YamlMethod;
  return convertMethod(raw);
}

/** Load a method YAML file from the registry by path convention. */
export function loadMethodFromFile(
  registryPath: string,
  methodologyId: string,
  methodId: string,
): Method<S> {
  const filePath = join(registryPath, methodologyId, methodId, `${methodId}.yaml`);
  if (!existsSync(filePath)) {
    throw new Error(`Method file not found: ${filePath}`);
  }
  const yamlStr = readFileSync(filePath, "utf-8");
  return loadMethodFromYamlString(yamlStr);
}

/** Load a YAML string and convert to MethodTS Methodology. */
export function loadMethodologyFromYamlString(yamlStr: string): Methodology<S> {
  const raw = yaml.load(yamlStr) as YamlMethodology;
  return convertMethodology(raw);
}

/** Load a methodology YAML file from the registry by path convention. */
export function loadMethodologyFromFile(
  registryPath: string,
  methodologyId: string,
): Methodology<S> {
  const filePath = join(registryPath, methodologyId, `${methodologyId}.yaml`);
  if (!existsSync(filePath)) {
    throw new Error(`Methodology file not found: ${filePath}`);
  }
  const yamlStr = readFileSync(filePath, "utf-8");
  return loadMethodologyFromYamlString(yamlStr);
}

// ── Conversion helpers ──

/** Convert raw YAML method to typed Method<S>. */
function convertMethod(raw: YamlMethod): Method<S> {
  const id = raw.method?.id ?? "unknown";
  const name = raw.method?.name ?? "Unknown Method";
  const domain = raw.domain_theory ? convertDomain(raw.domain_theory) : emptyDomain();
  const roles = (raw.roles ?? []).map(convertRole);
  const steps = (raw.phases ?? []).map(convertStep);
  const dag = buildLinearDAG(steps);
  const objective = parsePredicate<S>(raw.method?.objective ?? null);

  return {
    id,
    name,
    domain,
    roles,
    dag,
    objective,
    measures: [],
  };
}

/** Convert raw YAML methodology to typed Methodology<S>. */
function convertMethodology(raw: YamlMethodology): Methodology<S> {
  const id = raw.methodology?.id ?? "unknown";
  const name = raw.methodology?.name ?? "Unknown Methodology";
  const domain = raw.domain_theory ? convertDomain(raw.domain_theory) : emptyDomain();
  const arms = (raw.transition_function?.arms ?? []).map(convertArm);

  return {
    id,
    name,
    domain,
    arms,
    objective: TRUE as import("../predicate/predicate.js").Predicate<S>,
    terminationCertificate: defaultTerminationCertificate(),
    safety: defaultSafetyBounds(),
  };
}

/** Convert raw YAML domain theory to typed DomainTheory<S>. */
export function convertDomain(raw: YamlDomainTheory): DomainTheory<S> {
  const sorts: SortDecl[] = (raw.sorts ?? []).map((s) => ({
    name: s.name,
    description: s.description ?? "",
    cardinality: normalizeCardinality(s.cardinality),
  }));

  const functionSymbols: FunctionDecl[] = (raw.function_symbols ?? []).map((f) => {
    const { inputSorts, outputSort } = parseSignature(f.signature);
    return {
      name: f.name,
      inputSorts,
      outputSort,
      totality: (f.totality === "total" || f.totality === "partial") ? f.totality : "total",
      description: f.description,
    };
  });

  const predicates: Record<string, import("../predicate/predicate.js").Predicate<S>> = {};
  for (const p of raw.predicates ?? []) {
    predicates[p.name] = parsePredicate<S>(p.description ?? p.name);
  }

  const axioms: Record<string, import("../predicate/predicate.js").Predicate<S>> = {};
  for (const ax of raw.axioms ?? []) {
    const key = ax.id ?? ax.name ?? "unnamed";
    axioms[key] = parsePredicate<S>(ax.statement ?? "");
  }

  return {
    id: raw.id,
    signature: { sorts, functionSymbols, predicates },
    axioms,
  };
}

/** Convert a YAML phase to a typed Step<S>. */
function convertStep(raw: YamlPhase): Step<S> {
  const execution: StepExecution<S> = {
    tag: "script",
    execute: (s: S) => Effect.succeed(s),
  };

  return {
    id: raw.id,
    name: raw.name,
    role: raw.role ?? "default",
    precondition: parsePredicate<S>(raw.precondition),
    postcondition: parsePredicate<S>(raw.postcondition),
    execution,
    ...(raw.guidance ? { _guidance: new Prompt<S>(() => raw.guidance!) } : {}),
  };
}

/** Convert a YAML role to a typed Role<S>. */
function convertRole(raw: YamlRole): Role<S, unknown> {
  return {
    id: raw.id,
    description: raw.description ?? "",
    observe: (s: S) => s,
    authorized: raw.authorized ?? raw.authorized_transitions ?? [],
    notAuthorized: raw.not_authorized ?? [],
  };
}

/** Convert a YAML arm to a typed Arm<S>. */
function convertArm(raw: YamlArm): Arm<S> {
  // Determine method selection: "selects" field (bare ID) or "returns" field (Some(...)/None)
  const selectsStr = raw.selects ?? raw.returns ?? null;
  const methodId = selectsStr ? parseReturns(selectsStr) : null;

  return {
    priority: raw.priority,
    label: raw.label,
    condition: parsePredicate<S>(raw.condition),
    // selects is null for termination arms, otherwise a placeholder Method reference.
    // In a full registry load, these would be resolved to actual Method objects.
    selects: methodId ? stubMethod(methodId) : null,
    rationale: raw.rationale ?? "",
  };
}

// ── Internal helpers ──

/** Build a linear DAG from an ordered list of steps (sequential phases). */
function buildLinearDAG(steps: Step<S>[]): StepDAG<S> {
  if (steps.length === 0) {
    return { steps: [], edges: [], initial: "", terminal: "" };
  }

  const edges: StepEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push({ from: steps[i].id, to: steps[i + 1].id });
  }

  return {
    steps,
    edges,
    initial: steps[0].id,
    terminal: steps[steps.length - 1].id,
  };
}

/** Create a stub Method for arm selection (resolved later in full registry loads). */
function stubMethod(id: string): Method<S> {
  return {
    id,
    name: id,
    domain: emptyDomain(),
    roles: [],
    dag: { steps: [], edges: [], initial: "", terminal: "" },
    objective: TRUE as import("../predicate/predicate.js").Predicate<S>,
    measures: [],
  };
}

/** Empty domain theory for cases where YAML has no domain_theory section. */
function emptyDomain(): DomainTheory<S> {
  return {
    id: "empty",
    signature: { sorts: [], functionSymbols: [], predicates: {} },
    axioms: {},
  };
}

/** Normalize cardinality strings from YAML to the DomainTheory enum. */
function normalizeCardinality(raw: string | undefined): "finite" | "unbounded" | "singleton" {
  if (!raw) return "unbounded";
  const lower = raw.toLowerCase();
  if (lower === "finite") return "finite";
  if (lower === "singleton") return "singleton";
  // "unbounded", "infinite", or anything else → "unbounded"
  return "unbounded";
}

/**
 * Parse a function signature string like "Method x Gap -> Severity" into
 * input sorts and output sort.
 */
function parseSignature(sig: string | undefined): { inputSorts: string[]; outputSort: string } {
  if (!sig) return { inputSorts: [], outputSort: "unknown" };

  const parts = sig.split("->").map((s) => s.trim());
  if (parts.length < 2) {
    // No arrow — treat entire string as output sort
    return { inputSorts: [], outputSort: sig.trim() };
  }

  const inputStr = parts.slice(0, -1).join("->").trim();
  const outputSort = parts[parts.length - 1].trim();

  // Handle "Option(Verdict)" → "Verdict" (strip Option wrapper)
  const cleanOutput = outputSort.replace(/^Option\((.+)\)$/, "$1");

  // Split inputs by " x " (the cross-product notation used in registry YAML)
  const inputSorts = inputStr
    .split(/\s+x\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { inputSorts, outputSort: cleanOutput };
}

/** Default safety bounds for YAML-loaded methodologies. */
function defaultSafetyBounds(): SafetyBounds {
  return {
    maxLoops: 100,
    maxTokens: 10_000_000,
    maxCostUsd: 500,
    maxDurationMs: 86_400_000,
    maxDepth: 10,
  };
}

/** Default termination certificate (YAML doesn't encode executable measures). */
function defaultTerminationCertificate(): TerminationCertificate<S> {
  return {
    measure: () => 1,
    decreases: "YAML-loaded methodology — termination argument is in the YAML spec, not executable.",
  };
}
