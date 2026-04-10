/**
 * Method step-sequence smoke test case definitions.
 *
 * These test Pacta agent execution features: budget, output validation,
 * context compaction, reasoning policies, multi-step data flow.
 */

import type { SmokeTestCase } from './index.js';

export const methodCases: SmokeTestCase[] = [
  {
    id: 'method-multi-step',
    name: 'Multi-step method (analyse → critique → propose)',
    description: 'Three sequential agent invocations with data flowing between steps via an accumulating bundle. Verifies per-step token/cost tracking.',
    category: 'method',
    layer: 'agent',
    features: ['method-steps', 'data-flow', 'token-tracking', 'cost-tracking'],
    fixture: 'methods/analyse-critique-propose.ts',
    mode: 'live',
    expected: {
      status: 'completed',
      artifactsProduced: ['summary', 'issue', 'fix'],
    },
  },
  {
    id: 'method-tool-use',
    name: 'Method with tool use',
    description: 'Agent invocation that uses tools across multiple turns. Verifies tool_use and tool_result events stream correctly.',
    category: 'method',
    layer: 'agent',
    features: ['tool-use', 'multi-turn', 'agent-events'],
    fixture: 'methods/multi-turn-with-tools.ts',
    mode: 'live',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'method-budget-exhaust',
    name: 'Method budget exhaustion',
    description: 'Agent hits maxCostUsd limit mid-execution. Verifies budget_exhausted event and graceful stop.',
    category: 'method',
    layer: 'agent',
    features: ['budget-enforcement', 'budget-exhausted', 'graceful-stop'],
    fixture: 'methods/budget-exhaustion.ts',
    mode: 'mock',
    expected: {
      status: 'failed',
      errorContains: 'budget',
    },
  },
  {
    id: 'method-schema-retry',
    name: 'Method output schema retry',
    description: 'Agent output fails schema validation on first attempt. Retries with feedback and produces valid output.',
    category: 'method',
    layer: 'agent',
    features: ['output-validation', 'schema-retry', 'validation-feedback'],
    fixture: 'methods/output-schema-retry.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'method-context-compaction',
    name: 'Method context compaction',
    description: 'Long context triggers compaction. Verifies context_compacted event with fromTokens/toTokens.',
    category: 'method',
    layer: 'agent',
    features: ['context-compaction', 'context-policy', 'long-context'],
    fixture: 'methods/context-compaction.ts',
    mode: 'live',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'method-reflexion',
    name: 'Method reflexion reasoning',
    description: 'Agent with reflectOnFailure enabled. On failure, self-critique triggers reflection event before retry.',
    category: 'method',
    layer: 'agent',
    features: ['reasoning-policy', 'reflexion', 'reflect-on-failure'],
    fixture: 'methods/reasoning-reflexion.ts',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
];
