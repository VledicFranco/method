import type { Step, LoadedMethod, SessionStatus } from './types.js';

export type Session = {
  load(method: LoadedMethod): void;
  current(): Step;
  advance(): { previousStep: string; nextStep: string | null };
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

    current(): Step {
      const m = assertLoaded();
      return m.steps[currentIndex];
    },

    advance(): { previousStep: string; nextStep: string | null } {
      const m = assertLoaded();
      if (currentIndex >= m.steps.length - 1) {
        throw new Error('Already at terminal step — method is complete');
      }
      const previousStep = m.steps[currentIndex].id;
      currentIndex++;
      const nextStep = m.steps[currentIndex].id;
      return { previousStep, nextStep };
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
