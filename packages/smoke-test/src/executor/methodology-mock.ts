/**
 * Methodology mock executor — self-contained methodology session lifecycle
 * for smoke testing without the bridge server.
 *
 * Re-implements the minimal MethodologySessionStore interface using
 * @method/methodts types directly. All methodology data comes from
 * the fixture (methodology-lifecycle.ts) via a mock MethodologySource.
 *
 * This executor does NOT import from @method/bridge — it stays within the
 * L2 layer boundary of the smoke-test package.
 */

import {
  topologicalOrder,
  type Method,
  type Methodology,
  type Step,
  type Predicate,
} from '@method/methodts';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import {
  smokeTestMethodology,
  smokeTestCatalogEntry,
  analyzeMethod,
  implementMethod,
} from '../fixtures/methods/methodology-lifecycle.js';

// ── Types mirroring bridge store output shapes ────────────────────

type S = Record<string, unknown>;

export type CoreStep = {
  id: string;
  name: string;
  role: string | null;
  precondition: string | null;
  postcondition: string | null;
  guidance: string | null;
  outputSchema: Record<string, unknown> | null;
};

export type SessionStatus = {
  methodologyId: string;
  methodId: string;
  currentStepId: string;
  currentStepName: string;
  stepIndex: number;
  totalSteps: number;
};

export type AdvanceResult = {
  methodologyId: string;
  methodId: string;
  previousStep: { id: string; name: string };
  nextStep: { id: string; name: string } | null;
  stepIndex: number;
  totalSteps: number;
};

export type CurrentStepResult = {
  methodologyId: string;
  methodId: string;
  stepIndex: number;
  totalSteps: number;
  step: CoreStep;
};

export type PriorStepOutput = {
  stepId: string;
  summary: string;
};

export type PriorMethodOutput = {
  methodId: string;
  stepOutputs: Array<{ stepId: string; summary: string }>;
};

export type StepContext = {
  methodology: { id: string; name: string; progress: string };
  method: { id: string; name: string; objective: string | null };
  step: CoreStep;
  stepIndex: number;
  totalSteps: number;
  priorStepOutputs: PriorStepOutput[];
  priorMethodOutputs: PriorMethodOutput[];
};

export type ValidationResult = {
  valid: boolean;
  findings: Array<{ field: string; issue: string; severity: 'error' | 'warning' | 'info' }>;
  postconditionMet: boolean;
  recommendation: 'advance' | 'retry' | 'escalate';
};

export type RoutingPredicate = {
  name: string;
  description: string | null;
  trueWhen: string | null;
  falseWhen: string | null;
};

export type RoutingArm = {
  priority: number;
  label: string;
  condition: string;
  selects: string | null;
  rationale: string | null;
};

export type RoutingInfo = {
  methodologyId: string;
  name: string;
  predicates: RoutingPredicate[];
  arms: RoutingArm[];
  evaluationOrder: string;
};

type MethodologySessionStatus =
  | 'initialized'
  | 'routing'
  | 'executing'
  | 'transitioning'
  | 'completed'
  | 'failed';

type CompletedMethodRecord = {
  methodId: string;
  completedAt: string;
  stepOutputs: Array<{ stepId: string; outputSummary: string }>;
  completionSummary: string | null;
};

// ── Convert Step to CoreStep ──────────────────────────────────────

function convertStep(step: Step<S>): CoreStep {
  let precondition: string | null = null;
  if (step.precondition.tag === 'check') {
    precondition = step.precondition.label;
  } else if (step.precondition.tag === 'val') {
    precondition = step.precondition.value ? null : 'never';
  }

  let postcondition: string | null = null;
  if (step.postcondition.tag === 'check') {
    postcondition = step.postcondition.label;
  } else if (step.postcondition.tag === 'val') {
    postcondition = step.postcondition.value ? null : 'never';
  }

  return {
    id: step.id,
    name: step.name,
    role: step.role ?? null,
    precondition,
    postcondition,
    guidance: null,
    outputSchema: null,
  };
}

// ── Method lookup ─────────────────────────────────────────────────

const METHOD_MAP = new Map<string, Method<S>>([
  ['SMOKE-TEST-METH/M-ANALYZE', analyzeMethod],
  ['SMOKE-TEST-METH/M-IMPLEMENT', implementMethod],
]);

function getMethod(methodologyId: string, methodId: string): Method<S> | undefined {
  return METHOD_MAP.get(`${methodologyId}/${methodId}`);
}

function getMethodology(methodologyId: string): Methodology<S> | undefined {
  if (methodologyId === 'SMOKE-TEST-METH') return smokeTestMethodology;
  return undefined;
}

// ── Step Session (mirrors createMethodTSSession) ──────────────────

interface StepSession {
  load(methodologyId: string, method: Method<S>): void;
  current(): CurrentStepResult;
  advance(): AdvanceResult;
  status(): SessionStatus;
  context(): StepContext;
  isLoaded(): boolean;
  setMethodologyContext(id: string, name: string): void;
  recordStepOutput(stepId: string, output: Record<string, unknown>): void;
  getStepOutputs(): Array<{ stepId: string; output: Record<string, unknown> }>;
  setPriorMethodOutputs(outputs: PriorMethodOutput[]): void;
}

function createStepSession(): StepSession {
  let method: Method<S> | null = null;
  let methodologyId: string | null = null;
  let orderedSteps: Step<S>[] = [];
  let currentIndex = 0;
  const stepOutputs = new Map<string, Record<string, unknown>>();
  let priorMethodOutputsData: PriorMethodOutput[] = [];
  let methodologyContext: { id: string; name: string } | null = null;

  function assertLoaded() {
    if (!method || orderedSteps.length === 0) {
      throw new Error('No methodology loaded');
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
        throw new Error('Already at terminal step — method is complete');
      }
      const previousStep = {
        id: orderedSteps[currentIndex].id,
        name: orderedSteps[currentIndex].name,
      };
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
      const priorOutputs: PriorStepOutput[] = [];
      for (let i = 0; i < currentIndex; i++) {
        const stepId = orderedSteps[i].id;
        const output = stepOutputs.get(stepId);
        if (output) {
          const full = JSON.stringify(output);
          const summary = full.length > 200 ? full.slice(0, 200) + '...' : full;
          priorOutputs.push({ stepId, summary });
        }
      }

      let objective: string | null = null;
      if (m.objective.tag === 'check') {
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

    setMethodologyContext(id: string, name: string): void {
      methodologyContext = { id, name };
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
  };
}

// ── Condition evaluator (from bridge store) ───────────────────────

function evaluateCondition(
  condition: string,
  predicateValues: Map<string, boolean | null>,
): boolean {
  const clauses = condition.split(' AND ');
  for (const clause of clauses) {
    const trimmed = clause.trim();
    const negated = trimmed.startsWith('NOT ');
    const withoutNot = negated ? trimmed.slice(4).trim() : trimmed;

    const match = withoutNot.match(/^(\w+)\s*\(/);
    if (!match) continue;
    const predicateName = match[1];

    const value = predicateValues.get(predicateName);
    if (value === undefined || value === null) continue;

    const expected = !negated;
    if (value !== expected) return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
// MethodologyMock — the main executor class
// ══════════════════════════════════════════════════════════════════

export class MethodologyMock {
  private readonly stepSessions = new Map<string, StepSession>();
  private readonly methodologySessions = new Map<string, {
    id: string;
    methodologyId: string;
    methodologyName: string;
    challenge: string | null;
    status: MethodologySessionStatus;
    currentMethodId: string | null;
    completedMethods: CompletedMethodRecord[];
    globalObjectiveStatus: 'in_progress' | 'satisfied' | 'failed';
    routingInfo: RoutingInfo;
  }>();

  // ── list ──

  list(): CatalogMethodologyEntry[] {
    return [smokeTestCatalogEntry];
  }

  // ── getRouting ──

  getRouting(methodologyId: string): RoutingInfo {
    const methodology = getMethodology(methodologyId);
    if (!methodology) {
      throw new Error(`Methodology ${methodologyId} not found`);
    }

    const predicates: RoutingPredicate[] = Object.entries(
      methodology.domain.signature.predicates,
    ).map(([name, pred]) => ({
      name,
      description: pred.tag === 'check' ? pred.label : null,
      trueWhen: null,
      falseWhen: null,
    }));

    const arms: RoutingArm[] = methodology.arms.map((arm) => ({
      priority: arm.priority,
      label: arm.label,
      condition: arm.condition.tag === 'check' ? arm.condition.label : String(arm.condition.tag),
      selects: arm.selects?.id ?? null,
      rationale: arm.rationale,
    }));

    return {
      methodologyId: methodology.id,
      name: methodology.name,
      predicates,
      arms,
      evaluationOrder: 'priority-stack (arms evaluated 1..N, first match wins)',
    };
  }

  // ── startSession ──

  startSession(
    sessionId: string,
    methodologyId: string,
    challenge: string | null,
  ): {
    methodologySessionId: string;
    methodology: { id: string; name: string; objective: string | null; methodCount: number };
    transitionFunction: { predicateCount: number; armCount: number };
    status: 'initialized';
    message: string;
  } {
    const methodology = getMethodology(methodologyId);
    if (!methodology) {
      throw new Error(`Methodology ${methodologyId} not found`);
    }

    const routingInfo = this.getRouting(methodologyId);

    let objective: string | null = null;
    if (methodology.objective.tag === 'check') {
      objective = methodology.objective.label;
    }

    this.methodologySessions.set(sessionId, {
      id: sessionId,
      methodologyId,
      methodologyName: methodology.name,
      challenge,
      status: 'initialized',
      currentMethodId: null,
      completedMethods: [],
      globalObjectiveStatus: 'in_progress',
      routingInfo,
    });

    return {
      methodologySessionId: sessionId,
      methodology: {
        id: methodologyId,
        name: methodology.name,
        objective,
        methodCount: smokeTestCatalogEntry.methods.length,
      },
      transitionFunction: {
        predicateCount: routingInfo.predicates.length,
        armCount: routingInfo.arms.length,
      },
      status: 'initialized',
      message: `Methodology ${methodologyId} initialized.`,
    };
  }

  // ── route ──

  route(
    sessionId: string,
    challengePredicates?: Record<string, boolean>,
  ): {
    methodologyId: string;
    evaluatedPredicates: Array<{ name: string; value: boolean | null; source: 'provided' | 'inferred' }>;
    selectedArm: { priority: number; label: string; condition: string; rationale: string | null } | null;
    selectedMethod: { id: string; name: string; stepCount: number; description: string } | null;
    message: string;
  } {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error('No methodology session active.');
    }

    const { routingInfo } = methSession;
    const predicateValues = new Map<string, boolean | null>();
    for (const pred of routingInfo.predicates) {
      if (challengePredicates && pred.name in challengePredicates) {
        predicateValues.set(pred.name, challengePredicates[pred.name]);
      } else {
        predicateValues.set(pred.name, null);
      }
    }
    predicateValues.set('is_method_selected', methSession.currentMethodId !== null);
    predicateValues.set('method_completed', methSession.status === 'transitioning');

    const evaluatedPredicates: Array<{ name: string; value: boolean | null; source: 'provided' | 'inferred' }> = [];
    for (const pred of routingInfo.predicates) {
      if (challengePredicates && pred.name in challengePredicates) {
        evaluatedPredicates.push({ name: pred.name, value: challengePredicates[pred.name], source: 'provided' });
      } else {
        evaluatedPredicates.push({ name: pred.name, value: null, source: 'inferred' });
      }
    }

    const sortedArms = [...routingInfo.arms].sort((a, b) => a.priority - b.priority);
    let matchedArm: (typeof sortedArms)[0] | null = null;
    for (const arm of sortedArms) {
      if (evaluateCondition(arm.condition, predicateValues)) {
        matchedArm = arm;
        break;
      }
    }

    if (!matchedArm) {
      return {
        methodologyId: methSession.methodologyId,
        evaluatedPredicates,
        selectedArm: null,
        selectedMethod: null,
        message: 'No routing arm matched.',
      };
    }

    let selectedMethod: { id: string; name: string; stepCount: number; description: string } | null = null;
    if (matchedArm.selects) {
      const entry = smokeTestCatalogEntry.methods.find((m) => m.methodId === matchedArm!.selects);
      if (entry) {
        selectedMethod = {
          id: entry.methodId,
          name: entry.name,
          stepCount: entry.stepCount,
          description: entry.description,
        };
      }
    }

    return {
      methodologyId: methSession.methodologyId,
      evaluatedPredicates,
      selectedArm: {
        priority: matchedArm.priority,
        label: matchedArm.label,
        condition: matchedArm.condition,
        rationale: matchedArm.rationale,
      },
      selectedMethod,
      message: selectedMethod
        ? `Route selected: ${matchedArm.label} -> ${selectedMethod.id}`
        : `Route selected: ${matchedArm.label} -> terminate`,
    };
  }

  // ── select ──

  select(
    sessionId: string,
    methodologyId: string,
    selectedMethodId: string,
  ): {
    methodologySessionId: string;
    selectedMethod: {
      methodId: string;
      name: string;
      stepCount: number;
      firstStep: { id: string; name: string };
    };
    message: string;
  } {
    const method = getMethod(methodologyId, selectedMethodId);
    if (!method) {
      throw new Error(`Method ${selectedMethodId} not found in ${methodologyId}`);
    }

    const session = this.getOrCreateStepSession(sessionId);
    session.load(methodologyId, method);
    session.setMethodologyContext(methodologyId, smokeTestMethodology.name);

    const ordered = topologicalOrder(method.dag);

    // Also create/update methodology session
    const methSession = this.methodologySessions.get(sessionId);
    if (methSession) {
      methSession.currentMethodId = selectedMethodId;
      methSession.status = 'executing';
    }

    return {
      methodologySessionId: sessionId,
      selectedMethod: {
        methodId: method.id,
        name: method.name,
        stepCount: ordered.length,
        firstStep: { id: ordered[0].id, name: ordered[0].name },
      },
      message: `Selected ${method.id} — ${method.name}`,
    };
  }

  // ── loadMethodInSession ──

  loadMethodInSession(sessionId: string, methodId: string): {
    methodologySessionId: string;
    method: {
      id: string;
      name: string;
      stepCount: number;
      firstStep: { id: string; name: string };
    };
    message: string;
  } {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error('No methodology session active.');
    }

    const method = getMethod(methSession.methodologyId, methodId);
    if (!method) {
      throw new Error(`Method ${methodId} not found in ${methSession.methodologyId}`);
    }

    const session = this.getOrCreateStepSession(sessionId);
    session.load(methSession.methodologyId, method);
    session.setMethodologyContext(methSession.methodologyId, methSession.methodologyName);

    // Set prior method outputs
    const priorMethodOutputs: PriorMethodOutput[] = methSession.completedMethods.map((cm) => ({
      methodId: cm.methodId,
      stepOutputs: cm.stepOutputs.map((so) => ({
        stepId: so.stepId,
        summary: so.outputSummary,
      })),
    }));
    session.setPriorMethodOutputs(priorMethodOutputs);

    methSession.currentMethodId = methodId;
    methSession.status = 'executing';

    const ordered = topologicalOrder(method.dag);
    return {
      methodologySessionId: sessionId,
      method: {
        id: method.id,
        name: method.name,
        stepCount: ordered.length,
        firstStep: { id: ordered[0].id, name: ordered[0].name },
      },
      message: `Loaded ${method.id} — ${method.name}`,
    };
  }

  // ── Step operations ──

  getCurrentStep(sessionId: string): CurrentStepResult {
    return this.getOrCreateStepSession(sessionId).current();
  }

  getStepContext(sessionId: string): StepContext {
    return this.getOrCreateStepSession(sessionId).context();
  }

  advanceStep(sessionId: string): AdvanceResult {
    return this.getOrCreateStepSession(sessionId).advance();
  }

  getStatus(sessionId: string): SessionStatus {
    return this.getOrCreateStepSession(sessionId).status();
  }

  recordStepOutput(sessionId: string, stepId: string, output: Record<string, unknown>): void {
    this.getOrCreateStepSession(sessionId).recordStepOutput(stepId, output);
  }

  // ── validateStep ──

  validateStep(
    sessionId: string,
    stepId: string,
    output: Record<string, unknown>,
  ): ValidationResult {
    const session = this.getOrCreateStepSession(sessionId);
    const current = session.current();
    if (current.step.id !== stepId) {
      throw new Error(`step_id mismatch: expected ${current.step.id} but got ${stepId}`);
    }

    const findings: Array<{ field: string; issue: string; severity: 'error' | 'warning' | 'info' }> = [];
    const outputSchema = current.step.outputSchema;

    // Schema validation
    if (outputSchema !== null) {
      for (const key of Object.keys(outputSchema)) {
        if (key === 'type') continue;
        if (!(key in output)) {
          findings.push({ field: key, issue: `Missing required field: ${key}`, severity: 'error' });
        }
      }
    }

    // Postcondition check
    let postconditionMet = true;
    const postcondition = current.step.postcondition;
    if (postcondition !== null) {
      const keywords = postcondition
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
        .filter((w) => w.length > 3);
      if (keywords.length > 0) {
        const outputStr = JSON.stringify(output).toLowerCase();
        const matched = keywords.filter((kw) => outputStr.includes(kw));
        postconditionMet = matched.length >= keywords.length * 0.5;
      }
    }

    // Record output
    session.recordStepOutput(stepId, output);

    // Recommendation
    const hasErrors = findings.some((f) => f.severity === 'error');
    let recommendation: 'advance' | 'retry' | 'escalate';
    if (hasErrors) {
      recommendation = 'retry';
    } else if (!postconditionMet) {
      recommendation = 'escalate';
    } else {
      recommendation = 'advance';
    }

    return { valid: !hasErrors && postconditionMet, findings, postconditionMet, recommendation };
  }

  // ── transition ──

  transition(
    sessionId: string,
    completionSummary: string | null,
    challengePredicates?: Record<string, boolean>,
  ): {
    completedMethod: { id: string; name: string; outputsRecorded: number };
    methodologyProgress: { methodsCompleted: number; globalObjectiveStatus: string };
    nextMethod: { id: string; name: string; stepCount: number; description: string } | null;
    message: string;
  } {
    const methSession = this.methodologySessions.get(sessionId);
    if (!methSession) {
      throw new Error('No methodology session active.');
    }
    if (methSession.status !== 'executing') {
      throw new Error('Cannot transition: no method is currently executing');
    }
    if (methSession.currentMethodId === null) {
      throw new Error('Cannot transition: no method is currently executing');
    }

    const session = this.getOrCreateStepSession(sessionId);
    const stepOutputs = session.getStepOutputs();
    const outputEntries = stepOutputs.map((so) => ({
      stepId: so.stepId,
      outputSummary: JSON.stringify(so.output).slice(0, 200),
    }));

    const completedRecord: CompletedMethodRecord = {
      methodId: methSession.currentMethodId,
      completedAt: new Date().toISOString(),
      stepOutputs: outputEntries,
      completionSummary,
    };
    methSession.completedMethods.push(completedRecord);
    methSession.status = 'transitioning';
    methSession.currentMethodId = null;

    // Re-route
    const routeResult = this.route(sessionId, challengePredicates);

    if (routeResult.selectedMethod === null) {
      methSession.globalObjectiveStatus = 'satisfied';
      methSession.status = 'completed';
    }

    return {
      completedMethod: {
        id: completedRecord.methodId,
        name: completedRecord.methodId,
        outputsRecorded: outputEntries.length,
      },
      methodologyProgress: {
        methodsCompleted: methSession.completedMethods.length,
        globalObjectiveStatus: methSession.globalObjectiveStatus,
      },
      nextMethod: routeResult.selectedMethod,
      message: routeResult.selectedMethod
        ? `${completedRecord.methodId} completed. Next: ${routeResult.selectedMethod.id}`
        : `${completedRecord.methodId} completed. Methodology complete.`,
    };
  }

  // ── Internal helpers ──

  private getOrCreateStepSession(sessionId: string): StepSession {
    if (!this.stepSessions.has(sessionId)) {
      this.stepSessions.set(sessionId, createStepSession());
    }
    return this.stepSessions.get(sessionId)!;
  }
}
