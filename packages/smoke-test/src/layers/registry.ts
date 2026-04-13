/**
 * Layer registry — 4-entry static catalog.
 *
 * Narratives lifted verbatim from
 * method-1/tmp/smoke-test-visualization-design.md §L4-L1.
 * Colors from §Visual Language. Lifecycle operations from the
 * "Key operations" callouts in each layer's section.
 */

import type { Layer } from './types.js';

export const layerRegistry: Layer[] = [
  {
    id: 'methodology',
    level: 'L4',
    name: 'Methodology',
    narrative:
      'Selects which method to run next by evaluating routing predicates against state. ' +
      'A methodology is a coalgebraic transition system Phi = (D_Phi, delta_Phi, O_Phi). It maintains a session that tracks completed methods, their outputs, and global objective status. After each method completes, the transition function evaluates priority-ordered arms to select the next method. If no arm matches, the methodology is complete. ' +
      'A methodology never touches an LLM, never executes code, and never inspects artifacts. It operates purely on predicate logic over state.',
    color: '#c792ea',
    lifecycle: [
      'methodology_list',
      'methodology_start',
      'methodology_route',
      'methodology_select',
      'methodology_transition',
      'methodology_status',
    ],
    keyConcepts: [
      'coalgebraic session',
      'routing predicates',
      'priority-ordered arms',
      'global objective',
    ],
  },
  {
    id: 'method',
    level: 'L3',
    name: 'Method',
    narrative:
      'Orders steps into a DAG and manages step execution lifecycle. ' +
      'A method is a 5-tuple M = (D, Roles, Gamma, O, mu) that groups steps into a directed acyclic graph. Steps are ordered via topological sort and executed one at a time. Each step has preconditions (checked before entry), postconditions (validated after output), and execution semantics (agent or script). The method tracks step outputs and makes them available to subsequent steps as context. ' +
      'A method defines structure (the step graph) and contracts (pre/postconditions), but does not define how each step executes — that is the step\'s responsibility.',
    color: '#82aaff',
    lifecycle: ['step_current', 'step_context', 'step_advance', 'step_validate'],
    keyConcepts: [
      'step DAG',
      'preconditions',
      'postconditions',
      'topological order',
    ],
  },
  {
    id: 'strategy',
    level: 'L2',
    name: 'Strategy',
    narrative:
      'Orchestrates methodology sessions within a YAML-defined execution plan. ' +
      'A strategy is a YAML-defined DAG with nodes (methodology, script, strategy, semantic, context-load), gates (algorithmic, observation, human-approval, strategy-level), an artifact store, oversight rules, and budget enforcement. The executor traverses the DAG in topological order, running gates after each node, managing artifacts, and generating retrospectives. Methodology-type nodes invoke a full methodology session (which routes to methods and runs their steps); strategy-type nodes invoke sub-strategies recursively. ' +
      'Strategies are orchestration plans. They drive event-triggered pipelines and compose methodology runs. Steps inside a method do NOT invoke strategies — strategies sit alongside the Methodology→Method→Agent session stack as a separate orchestration axis.',
    color: '#c3e88d',
    lifecycle: [
      'parse_yaml',
      'validate_dag',
      'topological_sort',
      'execute_nodes',
      'evaluate_gates',
      'store_artifacts',
      'check_oversight',
      'generate_retro',
    ],
    keyConcepts: ['YAML DAG', 'nodes', 'gates', 'artifacts', 'oversight', 'retro'],
  },
  {
    id: 'agent',
    level: 'L1',
    name: 'Agent',
    narrative:
      'Manages an LLM agent conversation loop — prompt, multi-turn tool use, output validation, retry, budget. ' +
      'An agent is configured by a Pact and executed by the Pacta SDK. Despite the name "agent", this is a full conversation loop: the agent can call tools across multiple turns, retry with feedback on validation failure, compact context when it grows too long, and apply reflexion (self-critique before retry). Each loop produces one AgentResult with a stopReason (completed, budget_exhausted, timeout, killed, error). ' +
      'Agents handle the LLM interaction. Everything above the agent level is orchestration; the agent level is where the actual reasoning happens.',
    color: '#f78c6c',
    lifecycle: ['createAgent', 'invoke', 'tool_use', 'validate', 'retry', 'return'],
    keyConcepts: [
      'single LLM invocation',
      'Pact',
      'tool loop',
      'schema retry',
      'reflexion',
    ],
  },
];

export function getLayer(id: Layer['id']): Layer {
  const layer = layerRegistry.find((l) => l.id === id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  return layer;
}
