import type { LoadedMethod, SessionStatus, AdvanceResult, CurrentStepResult } from './types.js';

export type Session = {
  load(method: LoadedMethod): void;
  current(): CurrentStepResult;
  advance(): AdvanceResult;
  status(): SessionStatus;
  isLoaded(): boolean;
};

export function createSession(): Session {
  let method: LoadedMethod | null = null;
  let currentIndex = 0;

  function assertLoaded(): LoadedMethod {
    if (method === null) {
      throw new Error('No methodology loaded');
    }
    return method;
  }

  return {
    load(m: LoadedMethod): void {
      method = m;
      currentIndex = 0;
    },

    current(): CurrentStepResult {
      const m = assertLoaded();
      return {
        methodologyId: m.methodologyId,
        methodId: m.methodId,
        stepIndex: currentIndex,
        totalSteps: m.steps.length,
        step: m.steps[currentIndex],
      };
    },

    advance(): AdvanceResult {
      const m = assertLoaded();
      if (currentIndex >= m.steps.length - 1) {
        throw new Error('Already at terminal step — method is complete');
      }
      const previousStep = { id: m.steps[currentIndex].id, name: m.steps[currentIndex].name };
      currentIndex++;
      const atTerminal = currentIndex >= m.steps.length - 1;
      const nextStep = atTerminal
        ? null
        : { id: m.steps[currentIndex].id, name: m.steps[currentIndex].name };
      return {
        methodologyId: m.methodologyId,
        methodId: m.methodId,
        previousStep,
        nextStep,
        stepIndex: currentIndex,
        totalSteps: m.steps.length,
      };
    },

    status(): SessionStatus {
      const m = assertLoaded();
      return {
        methodologyId: m.methodologyId,
        methodId: m.methodId,
        currentStepId: m.steps[currentIndex].id,
        currentStepName: m.steps[currentIndex].name,
        stepIndex: currentIndex,
        totalSteps: m.steps.length,
      };
    },

    isLoaded(): boolean {
      return method !== null;
    },
  };
}

export type SessionManager = {
  getOrCreate(sessionId: string): Session;
};

export function createSessionManager(): SessionManager {
  const sessions = new Map<string, Session>();
  return {
    getOrCreate(sessionId: string): Session {
      let session = sessions.get(sessionId);
      if (!session) {
        session = createSession();
        sessions.set(sessionId, session);
      }
      return session;
    },
  };
}
