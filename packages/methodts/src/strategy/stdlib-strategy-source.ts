/**
 * StdlibStrategySource — wraps prebuilt strategies behind the StrategySource port.
 *
 * Provides an in-memory source of strategy definitions that can be:
 * 1. Registered programmatically (for testing or prebuilt strategies)
 * 2. Combined with a file-based source (for production)
 *
 * This is the canonical test double for the StrategySource interface.
 *
 * @see WS-2 — Strategy system unification
 */

import type { StrategyDAG, StrategyValidationResult } from "./dag-types.js";
import type { StrategySource, StrategyInfo } from "./strategy-source.js";
import { parseStrategyYaml, validateStrategyDAG } from "./dag-parser.js";

/**
 * In-memory strategy source — useful for testing and prebuilt strategies.
 *
 * Strategies are registered via add() and looked up by ID.
 * Substitutable: tests can create a StdlibStrategySource with mock strategies
 * and pass it wherever a StrategySource is expected.
 */
export class StdlibStrategySource implements StrategySource {
  private readonly strategies = new Map<string, StrategyDAG>();

  /** Register a strategy DAG. Overwrites if the ID already exists. */
  add(dag: StrategyDAG): void {
    this.strategies.set(dag.id, dag);
  }

  /** Register a strategy from YAML string. Parses and adds it. */
  addFromYaml(yamlContent: string): StrategyDAG {
    const dag = parseStrategyYaml(yamlContent);
    this.add(dag);
    return dag;
  }

  /** Remove a strategy by ID. Returns true if it existed. */
  remove(id: string): boolean {
    return this.strategies.delete(id);
  }

  /** Clear all registered strategies. */
  clear(): void {
    this.strategies.clear();
  }

  // ── StrategySource interface ──────────────────────────────────

  async list(): Promise<StrategyInfo[]> {
    return Array.from(this.strategies.values()).map((dag) => ({
      id: dag.id,
      name: dag.name,
      version: dag.version,
    }));
  }

  async load(id: string): Promise<StrategyDAG | null> {
    return this.strategies.get(id) ?? null;
  }

  parse(yaml: string): StrategyDAG {
    return parseStrategyYaml(yaml);
  }

  validate(dag: StrategyDAG): StrategyValidationResult {
    return validateStrategyDAG(dag);
  }
}
