/**
 * Methodology Session Store
 *
 * Wraps @method/methodts types in the interactive session interface that
 * HTTP route handlers expect. Migrated from @method/mcp's methodts-session.ts
 * into a self-contained class that takes registryDir in the constructor.
 *
 * CRITICAL: All return shapes must be identical to what the MCP tool handlers
 * produced so that downstream consumers see the same JSON output.
 */

import {
  loadMethodFromFile,
  loadMethodologyFromFile,
  topologicalOrder,
  evaluateTransition,
} from "@method/methodts";
import type {
  Method,
  Step,
  Methodology,
  Arm,
  DomainTheory,
} from "@method/methodts";
import { readdirSync, existsSync, statSync, readFileSync } from "fs";
import { join, basename } from "path";
import yaml from "js-yaml";

// ── Types matching core's output shapes ──

/**
 * Core's Step type (flat, JSON-friendly).
 * Maps from MethodTS's typed Step<S> to the flat shape MCP tools emit.
 */
type CoreStep = {
  id: string;
  name: string;
  role: string | null;
  precondition: string | null;
  postcondition: string | null;
  guidance: string | null;
  outputSchema: Record<string, unknown> | null;
};

type SessionStatus = {
  methodologyId: string;
  methodId: string;
  currentStepId: string;
  currentStepName: string;
  stepIndex: number;
  totalSteps: number;
};

type AdvanceResult = {
  methodologyId: string;
  methodId: string;
  previousStep: { id: string; name: string };
  nextStep: { id: string; name: string } | null;
  stepIndex: number;
  totalSteps: number;
};

type CurrentStepResult = {
  methodologyId: string;
  methodId: string;
  stepIndex: number;
  totalSteps: number;
  step: CoreStep;
};

type PriorStepOutput = {
  stepId: string;
  summary: string;
};

type PriorMethodOutput = {
  methodId: string;
  stepOutputs: Array<{ stepId: string; summary: string }>;
};

type StepContext = {
  methodology: {
    id: string;
    name: string;
    progress: string;
  };
  method: {
    id: string;
    name: string;
    objective: string | null;
  };
  step: CoreStep;
  stepIndex: number;
  totalSteps: number;
  priorStepOutputs: PriorStepOutput[];
  priorMethodOutputs: PriorMethodOutput[];
};

type S = Record<string, unknown>;

// ── Convert MethodTS Step to core-compatible flat step shape ──

function convertStep(step: Step<S>): CoreStep {
  // Extract precondition label
  let precondition: string | null = null;
  if (step.precondition.tag === "check") {
    precondition = step.precondition.label;
  } else if (step.precondition.tag === "val") {
    precondition = step.precondition.value ? null : "never";
  }

  // Extract postcondition label
  let postcondition: string | null = null;
  if (step.postcondition.tag === "check") {
    postcondition = step.postcondition.label;
  } else if (step.postcondition.tag === "val") {
    postcondition = step.postcondition.value ? null : "never";
  }

  // Extract guidance — YAML-loaded steps store it as _guidance (Prompt)
  let guidance: string | null = null;
  const anyStep = step as Step<S> & { _guidance?: { run: (a: unknown) => string } };
  if (anyStep._guidance) {
    try {
      guidance = anyStep._guidance.run({ state: {}, world: {}, insights: {}, domainFacts: "" });
    } catch {
      guidance = null;
    }
  } else if (step.execution.tag === "agent") {
    try {
      guidance = step.execution.prompt.run({ state: {}, world: {}, insights: {}, domainFacts: "" });
    } catch {
      guidance = null;
    }
  }

  return {
    id: step.id,
    name: step.name,
    role: step.role ?? null,
    precondition,
    postcondition,
    guidance,
    outputSchema: null,
  };
}

// ── MethodTS Session (replaces core Session) ──

interface MethodTSSession {
  load(methodologyId: string, method: Method<S>): void;
  current(): CurrentStepResult;
  advance(): AdvanceResult;
  status(): SessionStatus;
  context(): StepContext;
  isLoaded(): boolean;
  setMethodologyContext(methodologyId: string, methodologyName: string): void;
  recordStepOutput(stepId: string, output: Record<string, unknown>): void;
  getStepOutputs(): Array<{ stepId: string; output: Record<string, unknown> }>;
  setPriorMethodOutputs(outputs: PriorMethodOutput[]): void;
  getMethodName(): string | null;
  getObjective(): string | null;
}

function createMethodTSSession(): MethodTSSession {
  let method: Method<S> | null = null;
  let methodologyId: string | null = null;
  let orderedSteps: Step<S>[] = [];
  let currentIndex = 0;
  const stepOutputs = new Map<string, Record<string, unknown>>();
  let priorMethodOutputsData: PriorMethodOutput[] = [];
  let methodologyContext: { id: string; name: string } | null = null;

  function assertLoaded() {
    if (!method || orderedSteps.length === 0) {
      throw new Error("No methodology loaded");
    }
    return method;
  }

  return {
    load(methId: string, m: Method<S>) {
      method = m;
      methodologyId = methId;
      orderedSteps = topologicalOrder(m.dag);
      currentIndex = 0;
      stepOutputs.clear();
      // methodologyContext is preserved across loads
    },

    current(): CurrentStepResult {
      const m = assertLoaded();
      return {
        methodologyId: methodologyId!,
        methodId: m.id,
        stepIndex: currentIndex,
        totalSteps: orderedSteps.length,
        step: convertStep(orderedSteps[currentIndex]),
      };
    },

    advance(): AdvanceResult {
      const m = assertLoaded();
      if (currentIndex >= orderedSteps.length - 1) {
        throw new Error("Already at terminal step — method is complete");
      }
      const previousStep = { id: orderedSteps[currentIndex].id, name: orderedSteps[currentIndex].name };
      currentIndex++;
      const atTerminal = currentIndex >= orderedSteps.length - 1;
      const nextStep = atTerminal
        ? null
        : { id: orderedSteps[currentIndex].id, name: orderedSteps[currentIndex].name };
      return {
        methodologyId: methodologyId!,
        methodId: m.id,
        previousStep,
        nextStep,
        stepIndex: currentIndex,
        totalSteps: orderedSteps.length,
      };
    },

    status(): SessionStatus {
      const m = assertLoaded();
      const step = orderedSteps[currentIndex];
      return {
        methodologyId: methodologyId!,
        methodId: m.id,
        currentStepId: step.id,
        currentStepName: step.name,
        stepIndex: currentIndex,
        totalSteps: orderedSteps.length,
      };
    },

    context(): StepContext {
      const m = assertLoaded();

      // Build priorStepOutputs from recorded outputs for steps before currentIndex
      const priorOutputs: PriorStepOutput[] = [];
      for (let i = 0; i < currentIndex; i++) {
        const stepId = orderedSteps[i].id;
        const output = stepOutputs.get(stepId);
        if (output) {
          const full = JSON.stringify(output);
          const summary = full.length > 200 ? full.slice(0, 200) + "..." : full;
          priorOutputs.push({ stepId, summary });
        }
      }

      // Extract objective string from method
      let objective: string | null = null;
      if (m.objective.tag === "check") {
        objective = m.objective.label;
      }

      return {
        methodology: {
          id: methodologyContext?.id ?? methodologyId!,
          name: methodologyContext?.name ?? m.name,
          progress: `${currentIndex + 1} / ${orderedSteps.length}`,
        },
        method: {
          id: m.id,
          name: m.name,
          objective,
        },
        step: convertStep(orderedSteps[currentIndex]),
        stepIndex: currentIndex,
        totalSteps: orderedSteps.length,
        priorStepOutputs: priorOutputs,
        priorMethodOutputs: priorMethodOutputsData,
      };
    },

    isLoaded(): boolean {
      return method !== null;
    },

    setMethodologyContext(mId: string, mName: string): void {
      methodologyContext = { id: mId, name: mName };
    },

    recordStepOutput(stepId: string, output: Record<string, unknown>): void {
      stepOutputs.set(stepId, output);
    },

    getStepOutputs(): Array<{ stepId: string; output: Record<string, unknown> }> {
      return Array.from(stepOutputs.entries()).map(([stepId, output]) => ({ stepId, output }));
    },

    setPriorMethodOutputs(outputs: PriorMethodOutput[]): void {
      priorMethodOutputsData = outputs;
    },

    getMethodName(): string | null {
      return method?.name ?? null;
    },

    getObjective(): string | null {
      if (!method) return null;
      return method.objective.tag === "check" ? method.objective.label : null;
    },
  };
}

// ── Methodology Session State ──

type MethodologySessionStatus =
  | "initialized"
  | "routing"
  | "executing"
  | "transitioning"
  | "completed"
  | "failed";

type GlobalObjectiveStatus = "in_progress" | "satisfied" | "failed";

type CompletedMethodRecord = {
  methodId: string;
  completedAt: string;
  stepOutputs: Array<{ stepId: string; outputSummary: string }>;
  completionSummary: string | null;
};

// ── Routing types matching core's RoutingInfo ──

type RoutingPredicate = {
  name: string;
  description: string | null;
  trueWhen: string | null;
  falseWhen: string | null;
};

type RoutingArm = {
  priority: number;
  label: string;
  condition: string;
  selects: string | null;
  rationale: string | null;
};

type RoutingInfo = {
  methodologyId: string;
  name: string;
  predicates: RoutingPredicate[];
  arms: RoutingArm[];
  evaluationOrder: string;
};

type MethodologySessionState = {
  id: string;
  methodologyId: string;
  methodologyName: string;
  challenge: string | null;
  status: MethodologySessionStatus;
  currentMethodId: string | null;
  completedMethods: CompletedMethodRecord[];
  globalObjectiveStatus: GlobalObjectiveStatus;
  routingInfo: RoutingInfo;
};

// ── YAML helpers ──

function readYaml(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Failed to parse ${filePath}: YAML did not produce an object`);
  }
  return parsed as Record<string, unknown>;
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") return val.trim();
  }
  return null;
}

function findYamlFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Listing types ──

type MethodEntry = {
  methodId: string;
  name: string;
  description: string;
  stepCount: number;
};

type MethodologyEntry = {
  methodologyId: string;
  name: string;
  description: string;
  methods: MethodEntry[];
};

// ── Routing helper ──

function parseReturns(returns: string): string | null {
  if (returns === "None") return null;
  const match = returns.match(/^Some\((.+)\)$/);
  return match ? match[1] : null;
}

// ── Condition evaluator ──

function evaluateCondition(
  condition: string,
  predicateValues: Map<string, boolean | null>,
): boolean {
  const clauses = condition.split(" AND ");
  for (const clause of clauses) {
    const trimmed = clause.trim();
    const negated = trimmed.startsWith("NOT ");
    const withoutNot = negated ? trimmed.slice(4).trim() : trimmed;

    const match = withoutNot.match(/^(\w+)\s*\(/);
    if (!match) continue;
    const predicateName = match[1];

    const value = predicateValues.get(predicateName);
    if (value === undefined || value === null) {
      continue;
    }

    const expected = !negated;
    if (value !== expected) {
      return false;
    }
  }
  return true;
}

// ── Type checker for validation ──

type ValidationFinding = {
  field: string;
  issue: string;
  severity: "error" | "warning" | "info";
};

function checkType(
  fieldName: string,
  value: unknown,
  expectedType: string,
  findings: ValidationFinding[],
): void {
  const normalizedType = expectedType.toLowerCase();

  switch (normalizedType) {
    case "string":
      if (typeof value !== "string") {
        findings.push({
          field: fieldName,
          issue: `Expected string but got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    case "number":
    case "integer":
      if (typeof value !== "number") {
        findings.push({
          field: fieldName,
          issue: `Expected number but got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        findings.push({
          field: fieldName,
          issue: `Expected boolean but got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        findings.push({
          field: fieldName,
          issue: `Expected array but got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        findings.push({
          field: fieldName,
          issue: `Expected object but got ${Array.isArray(value) ? "array" : typeof value}`,
          severity: "error",
        });
      }
      break;
    case "enum":
      break;
    default:
      break;
  }
}

// ── Result types for methodology-level operations ──

type MethodologyStartResult = {
  methodologySessionId: string;
  methodology: {
    id: string;
    name: string;
    objective: string | null;
    methodCount: number;
  };
  transitionFunction: {
    predicateCount: number;
    armCount: number;
  };
  status: "initialized";
  message: string;
};

type EvaluatedPredicate = {
  name: string;
  value: boolean | null;
  source: "provided" | "inferred";
};

type MethodologyRouteResult = {
  methodologyId: string;
  evaluatedPredicates: EvaluatedPredicate[];
  selectedArm: {
    priority: number;
    label: string;
    condition: string;
    rationale: string | null;
  } | null;
  selectedMethod: {
    id: string;
    name: string;
    stepCount: number;
    description: string;
  } | null;
  priorMethodsCompleted: Array<{
    methodId: string;
    completedAt: string;
    outputSummary: string | null;
  }>;
  message: string;
};

type MethodologySelectResult = {
  methodologySessionId: string;
  selectedMethod: {
    methodId: string;
    name: string;
    stepCount: number;
    firstStep: { id: string; name: string };
  };
  message: string;
};

type MethodologyLoadMethodResult = {
  methodologySessionId: string;
  method: {
    id: string;
    name: string;
    stepCount: number;
    firstStep: { id: string; name: string };
  };
  methodologyProgress: {
    methodsCompleted: number;
    methodsRemaining: number | "unknown";
    currentMethodIndex: number;
  };
  priorMethodOutputs: Array<{
    methodId: string;
    stepOutputs: Array<{ stepId: string; summary: string }>;
  }>;
  message: string;
};

type MethodologyTransitionResult = {
  completedMethod: {
    id: string;
    name: string;
    stepCount: number;
    outputsRecorded: number;
  };
  methodologyProgress: {
    methodsCompleted: number;
    globalObjectiveStatus: GlobalObjectiveStatus;
  };
  nextMethod: {
    id: string;
    name: string;
    stepCount: number;
    description: string;
    routingRationale: string;
  } | null;
  message: string;
};

type ValidationResult = {
  valid: boolean;
  findings: ValidationFinding[];
  postconditionMet: boolean;
  recommendation: "advance" | "retry" | "escalate";
};

// ══════════════════════════════════════════════════════════════
// MethodologySessionStore — main exported class
// ══════════════════════════════════════════════════════════════

export class MethodologySessionStore {
  private readonly registryDir: string;
  private readonly stepSessions = new Map<string, MethodTSSession>();
  private readonly methodologySessions = new Map<string, MethodologySessionState>();

  constructor(registryDir: string) {
    this.registryDir = registryDir;
  }

  // ── Session helpers ──

  private getOrCreateStepSession(sessionId: string): MethodTSSession {
    if (!this.stepSessions.has(sessionId)) {
      this.stepSessions.set(sessionId, createMethodTSSession());
    }
    return this.stepSessions.get(sessionId)!;
  }

  // ── List methodologies ──

  private listMethodologiesInternal(): MethodologyEntry[] {
    const entries = readdirSync(this.registryDir, { withFileTypes: true });
    const methodologyDirs = entries.filter((e) => e.isDirectory());

    const result: MethodologyEntry[] = [];

    for (const dir of methodologyDirs) {
      const methodologyDir = join(this.registryDir, dir.name);
      const yamlFiles = findYamlFiles(methodologyDir);

      let methodologyId = dir.name;
      let methodologyName = dir.name;
      let methodologyDescription = "";
      const methods: MethodEntry[] = [];

      for (const filePath of yamlFiles) {
        let parsed: Record<string, unknown>;
        try {
          parsed = readYaml(filePath);
        } catch (e) {
          console.warn(`[methodology-store] Failed to parse ${filePath}: ${(e as Error).message}`);
          continue;
        }

        const methodBlock = parsed["method"] as Record<string, unknown> | undefined;
        const methodologyBlock = parsed["methodology"] as Record<string, unknown> | undefined;

        if (methodologyBlock) {
          methodologyId = extractString(methodologyBlock, "id") ?? dir.name;
          methodologyName = extractString(methodologyBlock, "name") ?? dir.name;
          const nav = parsed["navigation"] as Record<string, unknown> | undefined;
          methodologyDescription =
            extractString(nav ?? {}, "what") ??
            extractString(methodologyBlock, "description") ??
            "";
        } else if (methodBlock) {
          const phases = parsed["phases"] as unknown[] | undefined;
          const nav = parsed["navigation"] as Record<string, unknown> | undefined;
          methods.push({
            methodId: extractString(methodBlock, "id") ?? basename(filePath, ".yaml"),
            name: extractString(methodBlock, "name") ?? basename(filePath, ".yaml"),
            description:
              extractString(nav ?? {}, "what") ??
              extractString(methodBlock, "description") ??
              "",
            stepCount: Array.isArray(phases) ? phases.length : 0,
          });
        }
      }

      result.push({
        methodologyId,
        name: methodologyName,
        description: methodologyDescription,
        methods: methods.sort((a, b) => a.methodId.localeCompare(b.methodId)),
      });
    }

    return result.sort((a, b) => a.methodologyId.localeCompare(b.methodologyId));
  }

  // ── Get routing info ──

  private getRoutingInternal(methodologyId: string): RoutingInfo {
    const filePath = join(this.registryDir, methodologyId, `${methodologyId}.yaml`);

    if (!existsSync(filePath)) {
      throw new Error(`Methodology ${methodologyId} not found in registry`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = readYaml(filePath);
    } catch (e) {
      if ((e as Error).message.startsWith("Failed to parse")) {
        throw e;
      }
      throw new Error(`Failed to parse ${filePath}: ${(e as Error).message}`);
    }

    if (parsed["method"] && !parsed["methodology"]) {
      throw new Error(
        `YAML at ${filePath} is a method, not a methodology. Routing is only available for methodology-level files.`,
      );
    }

    const methodologyBlock = parsed["methodology"] as Record<string, unknown> | undefined;
    if (!methodologyBlock) {
      throw new Error(`Methodology ${methodologyId} not found in registry`);
    }

    const transitionFunction = parsed["transition_function"] as Record<string, unknown> | undefined;
    if (!transitionFunction) {
      throw new Error(`Methodology ${methodologyId} has no transition_function defined`);
    }

    const methodologyIdFromYaml = (methodologyBlock["id"] as string) ?? methodologyId;
    const methodologyName = (methodologyBlock["name"] as string) ?? methodologyId;

    const domainTheory = parsed["domain_theory"] as Record<string, unknown> | undefined;
    const formalPredicates = (domainTheory?.["predicates"] as Array<Record<string, unknown>>) ?? [];

    const predOp = parsed["predicate_operationalization"] as Record<string, unknown> | undefined;
    const opPredicates = (predOp?.["predicates"] as Array<Record<string, unknown>>) ?? [];
    const evaluationOrderStr = (predOp?.["evaluation_order"] as string) ?? "";

    const opMap = new Map<string, { trueWhen: string | null; falseWhen: string | null }>();
    for (const op of opPredicates) {
      const name = op["name"] as string;
      const trueWhen = typeof op["true_when"] === "string" ? op["true_when"].trim() : null;
      const falseWhen = typeof op["false_when"] === "string" ? op["false_when"].trim() : null;
      opMap.set(name, { trueWhen, falseWhen });
    }

    const predicates: RoutingPredicate[] = formalPredicates.map((fp) => {
      const name = fp["name"] as string;
      const description = typeof fp["description"] === "string" ? fp["description"].trim() : null;
      const op = opMap.get(name);
      return {
        name,
        description,
        trueWhen: op?.trueWhen ?? null,
        falseWhen: op?.falseWhen ?? null,
      };
    });

    const rawArms = (transitionFunction["arms"] as Array<Record<string, unknown>>) ?? [];
    const arms: RoutingArm[] = rawArms.map((arm) => ({
      priority: arm["priority"] as number,
      label: arm["label"] as string,
      condition: arm["condition"] as string,
      selects: parseReturns(arm["returns"] as string),
      rationale: typeof arm["rationale"] === "string" ? arm["rationale"].trim() : null,
    }));

    return {
      methodologyId: methodologyIdFromYaml,
      name: methodologyName,
      predicates,
      arms,
      evaluationOrder: evaluationOrderStr.trim(),
    };
  }

  // ── Route methodology ──

  private routeInternal(
    methodologySession: MethodologySessionState,
    challengePredicates?: Record<string, boolean>,
  ): MethodologyRouteResult {
    const { routingInfo } = methodologySession;

    // Build predicate values map
    const predicateValues = new Map<string, boolean | null>();
    for (const pred of routingInfo.predicates) {
      if (challengePredicates && pred.name in challengePredicates) {
        predicateValues.set(pred.name, challengePredicates[pred.name]);
      } else {
        predicateValues.set(pred.name, null);
      }
    }

    // Infer structural predicates from session state
    predicateValues.set("is_method_selected", methodologySession.currentMethodId !== null);
    predicateValues.set("method_completed", methodologySession.status === "transitioning");

    // Build evaluated predicates list
    const evaluatedPredicates: EvaluatedPredicate[] = [];
    for (const pred of routingInfo.predicates) {
      if (challengePredicates && pred.name in challengePredicates) {
        evaluatedPredicates.push({
          name: pred.name,
          value: challengePredicates[pred.name],
          source: "provided",
        });
      } else if (pred.name === "is_method_selected" || pred.name === "method_completed") {
        evaluatedPredicates.push({
          name: pred.name,
          value: predicateValues.get(pred.name)!,
          source: "inferred",
        });
      } else {
        evaluatedPredicates.push({
          name: pred.name,
          value: null,
          source: "inferred",
        });
      }
    }

    // Also add structural predicates if not already in the routing predicates list
    const predNames = new Set(routingInfo.predicates.map((p) => p.name));
    if (!predNames.has("is_method_selected")) {
      evaluatedPredicates.push({
        name: "is_method_selected",
        value: predicateValues.get("is_method_selected")!,
        source: "inferred",
      });
    }
    if (!predNames.has("method_completed")) {
      evaluatedPredicates.push({
        name: "method_completed",
        value: predicateValues.get("method_completed")!,
        source: "inferred",
      });
    }

    // Walk arms in priority order
    const sortedArms = [...routingInfo.arms].sort((a, b) => a.priority - b.priority);
    let matchedArm: (typeof sortedArms)[0] | null = null;

    for (const arm of sortedArms) {
      if (evaluateCondition(arm.condition, predicateValues)) {
        matchedArm = arm;
        break;
      }
    }

    // Build prior methods completed
    const priorMethodsCompleted = methodologySession.completedMethods.map((cm) => ({
      methodId: cm.methodId,
      completedAt: cm.completedAt,
      outputSummary: cm.completionSummary,
    }));

    if (!matchedArm) {
      return {
        methodologyId: methodologySession.methodologyId,
        evaluatedPredicates,
        selectedArm: null,
        selectedMethod: null,
        priorMethodsCompleted,
        message: "No routing arm matched. Provide additional predicate values to disambiguate.",
      };
    }

    // Look up method info if the arm selects one
    let selectedMethod: MethodologyRouteResult["selectedMethod"] = null;
    if (matchedArm.selects) {
      const methodologies = this.listMethodologiesInternal();
      const methodology = methodologies.find(
        (m) => m.methodologyId === methodologySession.methodologyId,
      );
      if (methodology) {
        const methodEntry = methodology.methods.find((m) => m.methodId === matchedArm!.selects);
        if (methodEntry) {
          selectedMethod = {
            id: methodEntry.methodId,
            name: methodEntry.name,
            stepCount: methodEntry.stepCount,
            description: methodEntry.description,
          };
        }
      }
    }

    const message = selectedMethod
      ? `Route selected: ${matchedArm.label} \u2192 ${selectedMethod.id} (${selectedMethod.name}). Call methodology_load_method to load it.`
      : `Route selected: ${matchedArm.label} \u2192 no method (${matchedArm.selects === null ? "terminate/continue" : "method not found"}).`;

    return {
      methodologyId: methodologySession.methodologyId,
      evaluatedPredicates,
      selectedArm: {
        priority: matchedArm.priority,
        label: matchedArm.label,
        condition: matchedArm.condition,
        rationale: matchedArm.rationale,
      },
      selectedMethod,
      priorMethodsCompleted,
      message,
    };
  }

  // ── Validate step output ──

  private validateStepOutputInternal(
    session: MethodTSSession,
    stepId: string,
    output: Record<string, unknown>,
  ): ValidationResult {
    // 1. Get current step and verify stepId matches
    const current = session.current();
    if (current.step.id !== stepId) {
      throw new Error(`step_id mismatch: expected ${current.step.id} but got ${stepId}`);
    }

    const findings: ValidationFinding[] = [];
    const outputSchema = current.step.outputSchema;
    const postcondition = current.step.postcondition;

    // 2. Schema validation (if output_schema is not null)
    if (outputSchema !== null) {
      const requiredFields = outputSchema["required_fields"] as
        | Array<Record<string, unknown>>
        | undefined;

      if (Array.isArray(requiredFields)) {
        for (const fieldDef of requiredFields) {
          const fieldName = fieldDef["name"] as string;
          if (!(fieldName in output)) {
            findings.push({
              field: fieldName,
              issue: `Missing required field: ${fieldName}`,
              severity: "error",
            });
            continue;
          }
          const expectedType = fieldDef["type"] as string | undefined;
          if (expectedType) {
            checkType(fieldName, output[fieldName], expectedType, findings);
          }
        }
      } else {
        for (const key of Object.keys(outputSchema)) {
          if (key === "type") continue;
          if (!(key in output)) {
            findings.push({
              field: key,
              issue: `Missing required field: ${key}`,
              severity: "error",
            });
            continue;
          }
          const schemaValue = outputSchema[key];
          if (typeof schemaValue === "string") {
            checkType(key, output[key], schemaValue, findings);
          } else if (
            typeof schemaValue === "object" &&
            schemaValue !== null &&
            "type" in schemaValue
          ) {
            checkType(
              key,
              output[key],
              (schemaValue as Record<string, unknown>)["type"] as string,
              findings,
            );
          }
        }
      }
    }

    // 3. Postcondition check (if postcondition is not null)
    let postconditionMet = true;
    if (postcondition !== null) {
      const keywords = postcondition
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())
        .filter((w) => w.length > 3);

      if (keywords.length > 0) {
        const outputStr = JSON.stringify(output).toLowerCase();
        const matched = keywords.filter((kw) => outputStr.includes(kw));
        postconditionMet = matched.length >= keywords.length * 0.5;
      }
    }

    // 4. Always record the output
    session.recordStepOutput(stepId, output);

    // 5. Recommendation logic
    const hasErrors = findings.some((f) => f.severity === "error");
    let recommendation: "advance" | "retry" | "escalate";
    if (hasErrors) {
      recommendation = "retry";
    } else if (!postconditionMet) {
      recommendation = "escalate";
    } else {
      recommendation = "advance";
    }

    return {
      valid: !hasErrors && postconditionMet,
      findings,
      postconditionMet,
      recommendation,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Public API — each method corresponds to one MCP tool handler
  // ══════════════════════════════════════════════════════════════

  /**
   * methodology_list — List all available methodologies and methods.
   */
  list(): object {
    return this.listMethodologiesInternal();
  }

  /**
   * methodology_load — Load a method into the active session.
   */
  loadMethod(sessionId: string, methodologyId: string, methodId: string): object {
    const session = this.getOrCreateStepSession(sessionId);
    const method = loadMethodFromFile(this.registryDir, methodologyId, methodId);
    session.load(methodologyId, method);
    const ordered = topologicalOrder(method.dag);
    // Extract objective string from Predicate
    const objective = method.objective.tag === "check" ? method.objective.label : null;
    return {
      methodologyId: methodologyId,
      methodId: method.id,
      methodName: method.name,
      stepCount: ordered.length,
      objective,
      firstStep: { id: ordered[0].id, name: ordered[0].name },
      message: `Loaded ${method.id} \u2014 ${method.name} (${ordered.length} steps). Call step_current to see the first step.`,
    };
  }

  /**
   * methodology_status — Show what method is loaded, current step, and progress.
   */
  getStatus(sessionId: string): object {
    const session = this.getOrCreateStepSession(sessionId);
    return session.status();
  }

  /**
   * step_current — Get the full record for the current step.
   */
  getCurrentStep(sessionId: string): object {
    const session = this.getOrCreateStepSession(sessionId);
    return session.current();
  }

  /**
   * step_advance — Mark the current step complete and advance to the next step.
   */
  advanceStep(sessionId: string): object {
    const session = this.getOrCreateStepSession(sessionId);
    return session.advance();
  }

  /**
   * step_context — Get enriched context for the current step.
   */
  getStepContext(sessionId: string): object {
    const session = this.getOrCreateStepSession(sessionId);
    return session.context();
  }

  /**
   * step_validate — Validate a sub-agent's output against the current step's schema.
   */
  validateStep(sessionId: string, stepId: string, output: Record<string, unknown>): object {
    const session = this.getOrCreateStepSession(sessionId);
    return this.validateStepOutputInternal(session, stepId, output);
  }

  /**
   * methodology_get_routing — Get the transition function and routing predicates.
   */
  getRouting(methodologyId: string): object {
    return this.getRoutingInternal(methodologyId);
  }

  /**
   * methodology_start — Start a methodology-level session.
   */
  startSession(
    sessionId: string,
    methodologyId: string,
    challenge: string | null,
  ): object {
    // 1. Find the methodology and validate it exists
    const methodologies = this.listMethodologiesInternal();
    const methodology = methodologies.find((m) => m.methodologyId === methodologyId);
    if (!methodology) {
      throw new Error(`Methodology ${methodologyId} not found`);
    }

    // 2. Get routing info
    const routingInfo = this.getRoutingInternal(methodologyId);

    // 3. Read objective from the methodology YAML
    let objective: string | null = null;
    try {
      const yamlPath = join(this.registryDir, methodologyId, `${methodologyId}.yaml`);
      const raw = readFileSync(yamlPath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        const objectiveBlock = parsed["objective"] as Record<string, unknown> | undefined;
        if (objectiveBlock && typeof objectiveBlock === "object") {
          const formal = objectiveBlock["formal"];
          const formalStatement = objectiveBlock["formal_statement"];
          if (typeof formal === "string") {
            objective = formal.trim();
          } else if (typeof formalStatement === "string") {
            objective = formalStatement.trim();
          }
        }
      }
    } catch (e) {
      console.warn(`[methodology-store] Failed to read methodology objective for ${methodologyId}: ${(e as Error).message}`);
    }

    // 4. Create session state
    const methSession: MethodologySessionState = {
      id: sessionId,
      methodologyId: methodology.methodologyId,
      methodologyName: methodology.name,
      challenge,
      status: "initialized",
      currentMethodId: null,
      completedMethods: [],
      globalObjectiveStatus: "in_progress",
      routingInfo,
    };
    this.methodologySessions.set(sessionId, methSession);

    // 5. Build result
    const result: MethodologyStartResult = {
      methodologySessionId: sessionId,
      methodology: {
        id: methodology.methodologyId,
        name: methodology.name,
        objective,
        methodCount: methodology.methods.length,
      },
      transitionFunction: {
        predicateCount: routingInfo.predicates.length,
        armCount: routingInfo.arms.length,
      },
      status: "initialized",
      message: `Methodology ${methodologyId} initialized. Call methodology_route to evaluate \u03B4_\u03A6 and select the first method.`,
    };

    return result;
  }

  /**
   * methodology_route — Evaluate delta-Phi against current state and return recommended method.
   */
  route(sessionId: string, challengePredicates?: Record<string, boolean>): object {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error("No methodology session active. Call methodology_start first.");
    }
    const result = this.routeInternal(methSession, challengePredicates);
    // State already mutated via reference in the map
    return result;
  }

  /**
   * methodology_select — Record a routing decision and initialize a methodology-level session.
   */
  select(
    sessionId: string,
    methodologyId: string,
    selectedMethodId: string,
  ): object {
    const session = this.getOrCreateStepSession(sessionId);

    // 1. List methodologies and find the matching one
    const methodologies = this.listMethodologiesInternal();
    const methodology = methodologies.find((m) => m.methodologyId === methodologyId);
    if (!methodology) {
      throw new Error(`Methodology ${methodologyId} not found`);
    }

    // 2. Find the method in the methodology's repertoire
    const methodEntry = methodology.methods.find((m) => m.methodId === selectedMethodId);
    if (!methodEntry) {
      throw new Error(
        `Method ${selectedMethodId} is not in methodology ${methodologyId}'s repertoire`,
      );
    }

    // 3. Load the method via MethodTS
    const method = loadMethodFromFile(this.registryDir, methodologyId, selectedMethodId);
    session.load(methodologyId, method);

    // 4. Record methodology context
    session.setMethodologyContext(methodologyId, methodology.name);

    // 5. Get step info
    const ordered = topologicalOrder(method.dag);

    // 6. Also create a methodology session for backward compatibility (PRD 004)
    try {
      const routingInfo = this.getRoutingInternal(methodologyId);
      const methSession: MethodologySessionState = {
        id: sessionId,
        methodologyId: methodology.methodologyId,
        methodologyName: methodology.name,
        challenge: null,
        status: "executing",
        currentMethodId: selectedMethodId,
        completedMethods: [],
        globalObjectiveStatus: "in_progress",
        routingInfo,
      };
      this.methodologySessions.set(sessionId, methSession);
    } catch {
      // Non-critical: if methodology session creation fails, the existing select still works
    }

    // 7. Return result
    return {
      methodologySessionId: sessionId,
      selectedMethod: {
        methodId: method.id,
        name: method.name,
        stepCount: ordered.length,
        firstStep: {
          id: ordered[0].id,
          name: ordered[0].name,
        },
      },
      message: `Selected ${method.id} \u2014 ${method.name} (${ordered.length} steps) under ${methodology.name}. Call step_context to get the first step's context.`,
    };
  }

  /**
   * methodology_load_method — Load a specific method within the active methodology session.
   */
  loadMethodInSession(sessionId: string, methodId: string): object {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error("No methodology session active. Call methodology_start first.");
    }

    // 1. Validate session status
    const allowedStatuses = ["initialized", "routing", "transitioning"];
    if (!allowedStatuses.includes(methSession.status)) {
      throw new Error(
        `Cannot load method when session status is '${methSession.status}'. ` +
          `Expected one of: ${allowedStatuses.join(", ")}.`,
      );
    }

    // 2. Find the methodology and verify method is in repertoire
    const methodologies = this.listMethodologiesInternal();
    const methodology = methodologies.find(
      (m) => m.methodologyId === methSession.methodologyId,
    );
    if (!methodology) {
      throw new Error(`Methodology ${methSession.methodologyId} not found`);
    }
    const methodEntry = methodology.methods.find((m) => m.methodId === methodId);
    if (!methodEntry) {
      throw new Error(
        `Method ${methodId} is not in methodology ${methSession.methodologyId}'s repertoire`,
      );
    }

    // 3. Load the method via MethodTS
    const method = loadMethodFromFile(this.registryDir, methSession.methodologyId, methodId);
    const ordered = topologicalOrder(method.dag);

    // 4. Load into session
    const session = this.getOrCreateStepSession(sessionId);
    session.load(methSession.methodologyId, method);

    // 5. Set methodology context
    session.setMethodologyContext(methSession.methodologyId, methSession.methodologyName);

    // 6. Set prior method outputs on the session
    const priorMethodOutputsData: PriorMethodOutput[] = methSession.completedMethods.map(
      (cm) => ({
        methodId: cm.methodId,
        stepOutputs: cm.stepOutputs.map((so) => ({
          stepId: so.stepId,
          summary: so.outputSummary,
        })),
      }),
    );
    session.setPriorMethodOutputs(priorMethodOutputsData);

    // 7. Update methodology session state (mutate)
    methSession.currentMethodId = methodId;
    methSession.status = "executing";

    // 8. Build prior method outputs for the result
    const priorMethodOutputs = methSession.completedMethods.map((cm) => ({
      methodId: cm.methodId,
      stepOutputs: cm.stepOutputs.map((so) => ({
        stepId: so.stepId,
        summary: so.outputSummary,
      })),
    }));

    // 9. Return result
    return {
      methodologySessionId: sessionId,
      method: {
        id: method.id,
        name: method.name,
        stepCount: ordered.length,
        firstStep: {
          id: ordered[0].id,
          name: ordered[0].name,
        },
      },
      methodologyProgress: {
        methodsCompleted: methSession.completedMethods.length,
        methodsRemaining: "unknown",
        currentMethodIndex: methSession.completedMethods.length,
      },
      priorMethodOutputs,
      message: `Loaded ${method.id} \u2014 ${method.name} (${ordered.length} steps) under ${methSession.methodologyName}. Call step_context to get the first step's context.`,
    };
  }

  /**
   * methodology_transition — Complete the current method and evaluate delta-Phi for the next method.
   */
  transition(
    sessionId: string,
    completionSummary: string | null,
    challengePredicates?: Record<string, boolean>,
  ): object {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error("No methodology session active. Call methodology_start first.");
    }

    // 1. Validate status
    if (methSession.status !== "executing") {
      throw new Error("Cannot transition: no method is currently executing");
    }

    // 2. Validate currentMethodId
    if (methSession.currentMethodId === null) {
      throw new Error("Cannot transition: no method is currently executing");
    }

    // 3. Gather step outputs from current method session
    const session = this.getOrCreateStepSession(sessionId);
    const stepOutputs = session.getStepOutputs();
    const outputEntries = stepOutputs.map((so) => ({
      stepId: so.stepId,
      outputSummary: JSON.stringify(so.output).slice(0, 200),
    }));

    // 4. Get the current method's name and step count
    let currentMethodName = methSession.currentMethodId;
    let currentStepCount = 0;
    try {
      const st = session.status();
      currentMethodName = st.methodId;
      currentStepCount = st.totalSteps;
    } catch (e) {
      console.warn(`[methodology-store] Could not get method status during transition: ${(e as Error).message}`);
    }

    // 5. Create completed method record
    const completedRecord: CompletedMethodRecord = {
      methodId: methSession.currentMethodId,
      completedAt: new Date().toISOString(),
      stepOutputs: outputEntries,
      completionSummary,
    };
    methSession.completedMethods.push(completedRecord);

    // 6. Update session state for re-routing
    methSession.status = "transitioning";
    methSession.currentMethodId = null;

    // 7. Re-evaluate routing
    const routeResult = this.routeInternal(methSession, challengePredicates);

    // 8. Determine next method and update status
    if (routeResult.selectedMethod === null) {
      methSession.globalObjectiveStatus = "satisfied";
      methSession.status = "completed";
    }

    // 9. Return result
    return {
      completedMethod: {
        id: completedRecord.methodId,
        name: currentMethodName,
        stepCount: currentStepCount,
        outputsRecorded: outputEntries.length,
      },
      methodologyProgress: {
        methodsCompleted: methSession.completedMethods.length,
        globalObjectiveStatus: methSession.globalObjectiveStatus,
      },
      nextMethod: routeResult.selectedMethod
        ? {
            id: routeResult.selectedMethod.id,
            name: routeResult.selectedMethod.name,
            stepCount: routeResult.selectedMethod.stepCount,
            description: routeResult.selectedMethod.description,
            routingRationale: routeResult.selectedArm?.rationale ?? "No rationale provided",
          }
        : null,
      message: routeResult.selectedMethod
        ? `${completedRecord.methodId} completed. \u03B4_\u03A6 re-evaluated \u2192 ${routeResult.selectedMethod.id} selected. Call methodology_load_method to begin.`
        : `${completedRecord.methodId} completed. Methodology complete \u2014 no further methods needed.`,
    };
  }
}
