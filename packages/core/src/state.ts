import type { LoadedMethod, SessionStatus, AdvanceResult, CurrentStepResult, StepContext, PriorMethodOutput } from './types.js';

export type Session = {
  load(method: LoadedMethod): void;
  current(): CurrentStepResult;
  advance(): AdvanceResult;
  status(): SessionStatus;
  context(): StepContext;
  isLoaded(): boolean;
  setMethodologyContext(methodologyId: string, methodologyName: string): void;
  recordStepOutput(stepId: string, output: Record<string, unknown>): void;
  getStepOutputs(): Array<{ stepId: string; output: Record<string, unknown> }>;
  setPriorMethodOutputs(outputs: PriorMethodOutput[]): void;
};

export function createSession(): Session {
  let method: LoadedMethod | null = null;
  let currentIndex = 0;
  let methodologyContext: { id: string; name: string } | null = null;
  const stepOutputs = new Map<string, Record<string, unknown>>();
  let priorMethodOutputsData: PriorMethodOutput[] = [];

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
      stepOutputs.clear();
      // methodologyContext is preserved across loads — it is set by selectMethodology
      // and should persist when the same methodology loads different methods
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

    context(): StepContext {
      const m = assertLoaded();

      // Build priorStepOutputs from recorded outputs for steps before currentIndex
      const priorOutputs: Array<{ stepId: string; summary: string }> = [];
      for (let i = 0; i < currentIndex; i++) {
        const stepId = m.steps[i].id;
        const output = stepOutputs.get(stepId);
        if (output) {
          const full = JSON.stringify(output);
          const summary = full.length > 200 ? full.slice(0, 200) + '...' : full;
          priorOutputs.push({ stepId, summary });
        }
      }

      return {
        methodology: {
          id: methodologyContext?.id ?? m.methodologyId,
          name: methodologyContext?.name ?? m.name,
          progress: `${currentIndex + 1} / ${m.steps.length}`,
        },
        method: {
          id: m.methodId,
          name: m.name,
          objective: m.objective,
        },
        step: m.steps[currentIndex],
        stepIndex: currentIndex,
        totalSteps: m.steps.length,
        priorStepOutputs: priorOutputs,
        priorMethodOutputs: priorMethodOutputsData,
      };
    },

    isLoaded(): boolean {
      return method !== null;
    },

    setMethodologyContext(methodologyId: string, methodologyName: string): void {
      methodologyContext = { id: methodologyId, name: methodologyName };
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
