/**
 * PRD 017: Strategy Pipelines — Strategy YAML Parser (Phase 1c)
 *
 * Parses Strategy YAML definitions into an internal StrategyDAG structure
 * and validates the DAG for correctness (acyclicity, reference integrity,
 * expression syntax, unique IDs).
 */

import yaml from 'js-yaml';
import type { GateConfig, GateType } from './gates.js';
import { getDefaultRetries, getDefaultTimeout } from './gates.js';

// ── Raw YAML Types ──────────────────────────────────────────────

/** Raw YAML structure — what the user writes */
export interface StrategyYaml {
  strategy: {
    id: string;
    name: string;
    version: string;

    triggers?: Array<{ type: string; tool?: string }>;

    context?: {
      inputs?: Array<{ name: string; type: string; default?: unknown }>;
    };

    capabilities?: Record<string, string[]>;

    dag: {
      nodes: Array<{
        id: string;
        type: 'methodology' | 'script';
        methodology?: string;
        method_hint?: string;
        capabilities?: string[];
        inputs?: string[];
        outputs?: string[];
        depends_on?: string[];
        gates?: Array<{
          type: GateType;
          check: string;
          max_retries?: number;
          timeout_ms?: number;
        }>;
        script?: string;
      }>;
      strategy_gates?: Array<{
        id: string;
        depends_on: string[];
        type: GateType;
        check: string;
        max_retries?: number;
        timeout_ms?: number;
      }>;
    };

    oversight?: {
      rules?: Array<{
        condition: string;
        action: 'escalate_to_human' | 'warn_human' | 'kill_and_requeue';
      }>;
    };

    outputs?: Array<{ type: string; target?: string }>;
  };
}

// ── Parsed Internal Types ───────────────────────────────────────

export interface MethodologyNodeConfig {
  type: 'methodology';
  methodology: string;
  method_hint?: string;
  capabilities: string[];
}

export interface ScriptNodeConfig {
  type: 'script';
  script: string;
}

export interface StrategyNode {
  id: string;
  type: 'methodology' | 'script';
  depends_on: string[];
  inputs: string[];
  outputs: string[];
  gates: GateConfig[];
  config: MethodologyNodeConfig | ScriptNodeConfig;
}

export interface OversightRule {
  condition: string;
  action: 'escalate_to_human' | 'warn_human' | 'kill_and_requeue';
}

export interface StrategyGate {
  id: string;
  depends_on: string[];
  gate: GateConfig;
}

export interface StrategyDAG {
  id: string;
  name: string;
  version: string;
  nodes: StrategyNode[];
  strategy_gates: StrategyGate[];
  capabilities: Record<string, string[]>;
  oversight_rules: OversightRule[];
  context_inputs: Array<{ name: string; type: string; default?: unknown }>;
}

// ── Parser Functions ────────────────────────────────────────────

/**
 * Parse a raw YAML string into a StrategyDAG.
 * Uses js-yaml for YAML parsing, then transforms into internal types.
 */
export function parseStrategyYaml(yamlContent: string): StrategyDAG {
  const raw = yaml.load(yamlContent) as StrategyYaml;
  return parseStrategyObject(raw);
}

/**
 * Parse a pre-parsed YAML object into a StrategyDAG.
 * Transforms the raw structure into the internal representation,
 * applying defaults for gate retries and timeouts.
 */
export function parseStrategyObject(obj: StrategyYaml): StrategyDAG {
  const s = obj.strategy;

  const nodes: StrategyNode[] = s.dag.nodes.map((rawNode) => {
    const gates: GateConfig[] = (rawNode.gates ?? []).map((g) => ({
      type: g.type,
      check: g.check,
      max_retries: g.max_retries ?? getDefaultRetries(g.type),
      timeout_ms: g.timeout_ms ?? getDefaultTimeout(g.type),
    }));

    let config: MethodologyNodeConfig | ScriptNodeConfig;

    if (rawNode.type === 'methodology') {
      config = {
        type: 'methodology',
        methodology: rawNode.methodology ?? '',
        method_hint: rawNode.method_hint,
        capabilities: rawNode.capabilities ?? [],
      };
    } else {
      config = {
        type: 'script',
        script: rawNode.script ?? '',
      };
    }

    return {
      id: rawNode.id,
      type: rawNode.type,
      depends_on: rawNode.depends_on ?? [],
      inputs: rawNode.inputs ?? [],
      outputs: rawNode.outputs ?? [],
      gates,
      config,
    };
  });

  // Strategy gates are single-shot by design — retries at strategy level would require re-running nodes
  const strategy_gates: StrategyGate[] = (s.dag.strategy_gates ?? []).map((sg) => ({
    id: sg.id,
    depends_on: sg.depends_on,
    gate: {
      type: sg.type,
      check: sg.check,
      max_retries: 0,
      timeout_ms: sg.timeout_ms ?? getDefaultTimeout(sg.type),
    },
  }));

  return {
    id: s.id,
    name: s.name,
    version: s.version,
    nodes,
    strategy_gates,
    capabilities: s.capabilities ?? {},
    oversight_rules: (s.oversight?.rules ?? []).map((r) => ({
      condition: r.condition,
      action: r.action,
    })),
    context_inputs: s.context?.inputs ?? [],
  };
}

// ── Validation ──────────────────────────────────────────────────

export interface StrategyValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a StrategyDAG for correctness.
 * Checks: acyclicity, reference integrity, unique IDs, capability references,
 * gate expression syntax, strategy_gates references.
 * Returns all errors found (does not stop at first).
 */
export function validateStrategyDAG(dag: StrategyDAG): StrategyValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set(dag.nodes.map((n) => n.id));

  // Check unique node IDs
  const seenIds = new Set<string>();
  for (const node of dag.nodes) {
    if (seenIds.has(node.id)) {
      errors.push(`Duplicate node ID: "${node.id}"`);
    }
    seenIds.add(node.id);
  }

  // Check depends_on references
  for (const node of dag.nodes) {
    for (const dep of node.depends_on) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  // Check methodology nodes have a non-empty methodology field
  for (const node of dag.nodes) {
    if (node.config.type === 'methodology') {
      const methConfig = node.config as MethodologyNodeConfig;
      if (!methConfig.methodology || methConfig.methodology.trim() === '') {
        errors.push(`Node "${node.id}": methodology node must have a non-empty "methodology" field`);
      }
    }
  }

  // Check capability references
  for (const node of dag.nodes) {
    if (node.config.type === 'methodology') {
      for (const cap of node.config.capabilities) {
        if (!dag.capabilities[cap]) {
          errors.push(`Node "${node.id}" references undefined capability set "${cap}"`);
        }
      }
    }
  }

  // Check strategy_gates depends_on references
  for (const sg of dag.strategy_gates) {
    for (const dep of sg.depends_on) {
      if (!nodeIds.has(dep)) {
        errors.push(`Strategy gate "${sg.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  // Check gate expression syntax
  for (const node of dag.nodes) {
    for (let i = 0; i < node.gates.length; i++) {
      const gate = node.gates[i];
      try {
        // eslint-disable-next-line no-new-func
        new Function('output', 'artifacts', 'execution_metadata', `return (${gate.check});`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Node "${node.id}" gate[${i}] has invalid check expression: ${msg}`);
      }
    }
  }

  for (const sg of dag.strategy_gates) {
    try {
      // eslint-disable-next-line no-new-func
      new Function('output', 'artifacts', 'execution_metadata', `return (${sg.gate.check});`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Strategy gate "${sg.id}" has invalid check expression: ${msg}`);
    }
  }

  // Check DAG is acyclic (DFS cycle detection)
  const cycleError = detectCycles(dag.nodes);
  if (cycleError) {
    errors.push(cycleError);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect cycles in the DAG using DFS.
 * Returns an error message if a cycle is found, null otherwise.
 */
function detectCycles(nodes: StrategyNode[]): string | null {
  const WHITE = 0; // unvisited (GRAY=1, BLACK=2 used in dfs())

  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
  }

  const adjMap = new Map<string, string[]>();
  for (const node of nodes) {
    adjMap.set(node.id, node.depends_on);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      const cycle = dfs(node.id, color, adjMap);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfs(
  nodeId: string,
  color: Map<string, number>,
  adjMap: Map<string, string[]>,
): string | null {
  color.set(nodeId, 1); // GRAY

  for (const dep of adjMap.get(nodeId) ?? []) {
    const depColor = color.get(dep);
    if (depColor === undefined) continue; // unknown node — caught by validation
    if (depColor === 1) {
      return `Cyclic dependency detected involving nodes "${nodeId}" and "${dep}"`;
    }
    if (depColor === 0) {
      const result = dfs(dep, color, adjMap);
      if (result) return result;
    }
  }

  color.set(nodeId, 2); // BLACK
  return null;
}

// ── Topological Sort ────────────────────────────────────────────

/**
 * Compute a topological ordering of the DAG grouped by levels.
 * Returns an array of levels — each level is an array of node IDs
 * that can execute in parallel (all dependencies are in earlier levels).
 *
 * Uses Kahn's algorithm (BFS-based).
 * Throws if the DAG contains cycles.
 */
export function topologicalSort(dag: StrategyDAG): string[][] {
  // Build in-degree map and adjacency list (dependents)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // node → nodes that depend on it

  for (const node of dag.nodes) {
    if (!inDegree.has(node.id)) {
      inDegree.set(node.id, 0);
    }
    if (!dependents.has(node.id)) {
      dependents.set(node.id, []);
    }
  }

  for (const node of dag.nodes) {
    for (const dep of node.depends_on) {
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      const deps = dependents.get(dep);
      if (deps) {
        deps.push(node.id);
      }
    }
  }

  const levels: string[][] = [];
  let queue: string[] = [];

  // Start with nodes that have no dependencies
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  let processedCount = 0;

  while (queue.length > 0) {
    levels.push([...queue]);
    processedCount += queue.length;

    const nextQueue: string[] = [];
    for (const nodeId of queue) {
      for (const dependent of dependents.get(nodeId) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          nextQueue.push(dependent);
        }
      }
    }
    queue = nextQueue;
  }

  if (processedCount !== dag.nodes.length) {
    throw new Error('DAG contains a cycle — topological sort failed');
  }

  return levels;
}
