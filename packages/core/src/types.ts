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
  selects: string | null;  // method ID extracted from "Some(M7-PRDS)"; null for "None"
  rationale: string | null;
};

export type RoutingInfo = {
  methodologyId: string;
  name: string;
  predicates: RoutingPredicate[];
  arms: RoutingArm[];
  evaluationOrder: string;
};

export type PriorStepOutput = {
  stepId: string;
  summary: string;
};

export type MethodologySelectResult = {
  methodologySessionId: string;
  selectedMethod: {
    methodId: string;
    name: string;
    stepCount: number;
    firstStep: { id: string; name: string };
  };
  message: string;
};

export type ValidationFinding = {
  field: string;
  issue: string;
  severity: 'error' | 'warning' | 'info';
};

export type ValidationResult = {
  valid: boolean;
  findings: ValidationFinding[];
  postconditionMet: boolean;
  recommendation: 'advance' | 'retry' | 'escalate';
};

export type StepContext = {
  methodology: {
    id: string;
    name: string;
    progress: string;  // e.g., "3 / 7"
  };
  method: {
    id: string;
    name: string;
    objective: string | null;
  };
  step: Step;
  stepIndex: number;
  totalSteps: number;
  priorStepOutputs: PriorStepOutput[];
};

export type MethodologySessionStatus =
  | 'initialized'
  | 'routing'
  | 'executing'
  | 'transitioning'
  | 'completed'
  | 'failed';

export type GlobalObjectiveStatus = 'in_progress' | 'satisfied' | 'failed';

export type CompletedMethodRecord = {
  methodId: string;
  completedAt: string;
  stepOutputs: Array<{ stepId: string; outputSummary: string }>;
  completionSummary: string | null;
};

export type MethodologySessionData = {
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

export type MethodologyStartResult = {
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
  status: 'initialized';
  message: string;
};

export type EvaluatedPredicate = {
  name: string;
  value: boolean | null;
  source: 'provided' | 'inferred';
};

export type MethodologyRouteResult = {
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

export type MethodologyLoadMethodResult = {
  methodologySessionId: string;
  method: {
    id: string;
    name: string;
    stepCount: number;
    firstStep: { id: string; name: string };
  };
  methodologyProgress: {
    methodsCompleted: number;
    methodsRemaining: number | 'unknown';
    currentMethodIndex: number;
  };
  priorMethodOutputs: Array<{
    methodId: string;
    stepOutputs: Array<{ stepId: string; summary: string }>;
  }>;
  message: string;
};
