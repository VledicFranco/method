export type Step = {
  id: string;
  name: string;
  role: string | null;
  precondition: string | null;
  postcondition: string | null;
  guidance: string | null;
  outputSchema: Record<string, unknown> | null;
};

export type LoadedMethod = {
  methodologyId: string;
  methodId: string;
  name: string;
  objective: string | null;
  steps: Step[];
};

export type MethodEntry = {
  methodId: string;
  name: string;
  description: string;
  stepCount: number;
};

export type MethodologyEntry = {
  methodologyId: string;
  name: string;
  description: string;
  methods: MethodEntry[];
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
  step: Step;
};

export type TheoryResult = {
  source: string;
  section: string;
  label?: string;
  content: string;
};
