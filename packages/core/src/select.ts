import { listMethodologies, loadMethodology } from './loader.js';
import type { Session } from './state.js';
import type { MethodologySelectResult } from './types.js';

export function selectMethodology(
  registryPath: string,
  methodologyId: string,
  selectedMethodId: string,
  session: Session,
  sessionId: string,
): MethodologySelectResult {
  // 1. List methodologies and find the matching one
  const methodologies = listMethodologies(registryPath);
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

  // 3. Load the method into the session
  const loadedMethod = loadMethodology(registryPath, methodologyId, selectedMethodId);
  session.load(loadedMethod);

  // 4. Record methodology context
  session.setMethodologyContext(methodologyId, methodology.name);

  // 5. Return result
  return {
    methodologySessionId: sessionId,
    selectedMethod: {
      methodId: loadedMethod.methodId,
      name: loadedMethod.name,
      stepCount: loadedMethod.steps.length,
      firstStep: {
        id: loadedMethod.steps[0].id,
        name: loadedMethod.steps[0].name,
      },
    },
    message: `Selected ${loadedMethod.methodId} — ${loadedMethod.name} (${loadedMethod.steps.length} steps) under ${methodology.name}. Call step_context to get the first step's context.`,
  };
}
