import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { listMethodologies, loadMethodology } from './loader.js';
import { getMethodologyRouting } from './routing.js';
import type { Session } from './state.js';
import type {
  MethodologySessionData,
  MethodologyStartResult,
  MethodologyRouteResult,
  MethodologyLoadMethodResult,
  EvaluatedPredicate,
} from './types.js';

export type MethodologySessionManager = {
  get(sessionId: string): MethodologySessionData | null;
  set(sessionId: string, session: MethodologySessionData): void;
};

export function createMethodologySessionManager(): MethodologySessionManager {
  const sessions = new Map<string, MethodologySessionData>();
  return {
    get(sessionId: string): MethodologySessionData | null {
      return sessions.get(sessionId) ?? null;
    },
    set(sessionId: string, session: MethodologySessionData): void {
      sessions.set(sessionId, session);
    },
  };
}

export function startMethodologySession(
  registryPath: string,
  methodologyId: string,
  challenge: string | null,
  sessionId: string,
): { session: MethodologySessionData; result: MethodologyStartResult } {
  // 1. Find the methodology and validate it exists
  const methodologies = listMethodologies(registryPath);
  const methodology = methodologies.find((m) => m.methodologyId === methodologyId);
  if (!methodology) {
    throw new Error(`Methodology ${methodologyId} not found`);
  }

  // 2. Get routing info
  const routingInfo = getMethodologyRouting(registryPath, methodologyId);

  // 3. Read objective from the methodology YAML
  let objective: string | null = null;
  try {
    const yamlPath = join(registryPath, methodologyId, `${methodologyId}.yaml`);
    const raw = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') {
      const objectiveBlock = parsed['objective'] as Record<string, unknown> | undefined;
      if (objectiveBlock && typeof objectiveBlock === 'object') {
        const formal = objectiveBlock['formal'];
        const formalStatement = objectiveBlock['formal_statement'];
        if (typeof formal === 'string') {
          objective = formal.trim();
        } else if (typeof formalStatement === 'string') {
          objective = formalStatement.trim();
        }
      }
    }
  } catch {
    // If we can't read the YAML for objective, leave it null
  }

  // 4. Create MethodologySessionData
  const session: MethodologySessionData = {
    id: sessionId,
    methodologyId: methodology.methodologyId,
    methodologyName: methodology.name,
    challenge,
    status: 'initialized',
    currentMethodId: null,
    completedMethods: [],
    globalObjectiveStatus: 'in_progress',
    routingInfo,
  };

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
    status: 'initialized',
    message: `Methodology ${methodologyId} initialized. Call methodology_route to evaluate \u03B4_\u03A6 and select the first method.`,
  };

  return { session, result };
}

/**
 * Evaluate a condition string from a transition function arm against known predicate values.
 * Returns true if the condition matches (all clauses pass or are inconclusive).
 * Returns false if any clause contradicts the known values.
 */
function evaluateCondition(
  condition: string,
  predicateValues: Map<string, boolean | null>,
): boolean {
  const clauses = condition.split(' AND ');
  for (const clause of clauses) {
    const trimmed = clause.trim();
    const negated = trimmed.startsWith('NOT ');
    const withoutNot = negated ? trimmed.slice(4).trim() : trimmed;

    // Extract predicate name: the identifier before '(' e.g. "is_method_selected(s)" -> "is_method_selected"
    const match = withoutNot.match(/^(\w+)\s*\(/);
    if (!match) continue; // skip unrecognized clause structure
    const predicateName = match[1];

    const value = predicateValues.get(predicateName);
    if (value === undefined || value === null) {
      // Inconclusive — skip (treat as matching)
      continue;
    }

    const expected = !negated; // NOT means we expect false; no NOT means we expect true
    if (value !== expected) {
      return false; // Contradiction — arm doesn't match
    }
  }
  return true;
}

/**
 * Evaluate δ_Φ against current session state and provided predicates.
 * Returns the routing recommendation: which arm matched, which method is selected.
 */
export function routeMethodology(
  registryPath: string,
  methodologySession: MethodologySessionData,
  challengePredicates?: Record<string, boolean>,
): MethodologyRouteResult {
  const { routingInfo } = methodologySession;

  // Build predicate values map
  const predicateValues = new Map<string, boolean | null>();

  // Add provided predicates
  for (const pred of routingInfo.predicates) {
    if (challengePredicates && pred.name in challengePredicates) {
      predicateValues.set(pred.name, challengePredicates[pred.name]);
    } else {
      predicateValues.set(pred.name, null);
    }
  }

  // Infer structural predicates from session state
  predicateValues.set('is_method_selected', methodologySession.currentMethodId !== null);
  predicateValues.set('method_completed', methodologySession.status === 'transitioning');

  // Build evaluated predicates list
  const evaluatedPredicates: EvaluatedPredicate[] = [];
  for (const pred of routingInfo.predicates) {
    if (challengePredicates && pred.name in challengePredicates) {
      evaluatedPredicates.push({
        name: pred.name,
        value: challengePredicates[pred.name],
        source: 'provided',
      });
    } else if (pred.name === 'is_method_selected' || pred.name === 'method_completed') {
      evaluatedPredicates.push({
        name: pred.name,
        value: predicateValues.get(pred.name)!,
        source: 'inferred',
      });
    } else {
      evaluatedPredicates.push({
        name: pred.name,
        value: null,
        source: 'inferred',
      });
    }
  }

  // Also add structural predicates if not already in the routing predicates list
  const predNames = new Set(routingInfo.predicates.map(p => p.name));
  if (!predNames.has('is_method_selected')) {
    evaluatedPredicates.push({
      name: 'is_method_selected',
      value: predicateValues.get('is_method_selected')!,
      source: 'inferred',
    });
  }
  if (!predNames.has('method_completed')) {
    evaluatedPredicates.push({
      name: 'method_completed',
      value: predicateValues.get('method_completed')!,
      source: 'inferred',
    });
  }

  // Walk arms in priority order
  const sortedArms = [...routingInfo.arms].sort((a, b) => a.priority - b.priority);
  let matchedArm: typeof sortedArms[0] | null = null;

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
      message: 'No routing arm matched. Provide additional predicate values to disambiguate.',
    };
  }

  // Look up method info if the arm selects one
  let selectedMethod: MethodologyRouteResult['selectedMethod'] = null;
  if (matchedArm.selects) {
    const methodologies = listMethodologies(registryPath);
    const methodology = methodologies.find((m) => m.methodologyId === methodologySession.methodologyId);
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
    ? `Route selected: ${matchedArm.label} → ${selectedMethod.id} (${selectedMethod.name}). Call methodology_load_method to load it.`
    : `Route selected: ${matchedArm.label} → no method (${matchedArm.selects === null ? 'terminate/continue' : 'method not found'}).`;

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

/**
 * Load a method within an active methodology session.
 */
export function loadMethodInSession(
  registryPath: string,
  methodologySession: MethodologySessionData,
  methodId: string,
  session: Session,
  sessionId: string,
): MethodologyLoadMethodResult {
  // 1. Validate session status
  const allowedStatuses = ['initialized', 'routing', 'transitioning'];
  if (!allowedStatuses.includes(methodologySession.status)) {
    throw new Error(
      `Cannot load method when session status is '${methodologySession.status}'. ` +
      `Expected one of: ${allowedStatuses.join(', ')}.`
    );
  }

  // 2. Find the methodology and verify method is in repertoire
  const methodologies = listMethodologies(registryPath);
  const methodology = methodologies.find((m) => m.methodologyId === methodologySession.methodologyId);
  if (!methodology) {
    throw new Error(`Methodology ${methodologySession.methodologyId} not found`);
  }
  const methodEntry = methodology.methods.find((m) => m.methodId === methodId);
  if (!methodEntry) {
    throw new Error(
      `Method ${methodId} is not in methodology ${methodologySession.methodologyId}'s repertoire`
    );
  }

  // 3. Load the method
  const loadedMethod = loadMethodology(registryPath, methodologySession.methodologyId, methodId);

  // 4. Load into session
  session.load(loadedMethod);

  // 5. Set methodology context
  session.setMethodologyContext(methodologySession.methodologyId, methodologySession.methodologyName);

  // 6. Update methodology session state (mutate)
  methodologySession.currentMethodId = methodId;
  methodologySession.status = 'executing';

  // 7. Build prior method outputs
  const priorMethodOutputs = methodologySession.completedMethods.map((cm) => ({
    methodId: cm.methodId,
    stepOutputs: cm.stepOutputs.map((so) => ({
      stepId: so.stepId,
      summary: so.outputSummary,
    })),
  }));

  // 8. Return result
  return {
    methodologySessionId: sessionId,
    method: {
      id: loadedMethod.methodId,
      name: loadedMethod.name,
      stepCount: loadedMethod.steps.length,
      firstStep: {
        id: loadedMethod.steps[0].id,
        name: loadedMethod.steps[0].name,
      },
    },
    methodologyProgress: {
      methodsCompleted: methodologySession.completedMethods.length,
      methodsRemaining: 'unknown',
      currentMethodIndex: methodologySession.completedMethods.length,
    },
    priorMethodOutputs,
    message: `Loaded ${loadedMethod.methodId} — ${loadedMethod.name} (${loadedMethod.steps.length} steps) under ${methodologySession.methodologyName}. Call step_context to get the first step's context.`,
  };
}
