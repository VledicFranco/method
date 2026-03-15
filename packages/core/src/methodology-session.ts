import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { listMethodologies } from './loader.js';
import { getMethodologyRouting } from './routing.js';
import type { MethodologySessionData, MethodologyStartResult } from './types.js';

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
