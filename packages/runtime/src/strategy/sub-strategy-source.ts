/**
 * FsSubStrategySource — filesystem-backed SubStrategySource port.
 *
 * Implements the SubStrategySource port from @method/methodts. Reads strategy
 * YAML files from a project's .method/strategies/ directory, parses them into
 * StrategyDAG objects, and returns null when the ID is not found.
 *
 * Injected with FileSystemProvider (G-PORT compliant). Transport-agnostic:
 * no HTTP, WebSocket, or direct fs imports.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/
 * (renamed from `BridgeSubStrategySource` → `FsSubStrategySource`).
 */

import { join } from 'node:path';
import type { SubStrategySource, StrategyDAG } from '@method/methodts/strategy/dag-types.js';
import { parseStrategyYaml } from '@method/methodts/strategy/dag-parser.js';
import type { FileSystemProvider } from '../ports/file-system.js';

export class FsSubStrategySource implements SubStrategySource {
  /**
   * @param strategyDir - Absolute path to the .method/strategies/ directory to scan.
   *                      Typically: join(projectRoot, '.method', 'strategies')
   * @param fs - FileSystemProvider injected from the composition root.
   */
  constructor(
    private readonly strategyDir: string,
    private readonly fs: FileSystemProvider,
  ) {}

  async getStrategy(id: string): Promise<StrategyDAG | null> {
    // Try both .yaml and .yml extensions, normalized to lowercase kebab-case ID
    const candidateNames = [`${id}.yaml`, `${id}.yml`];

    for (const name of candidateNames) {
      const filePath = join(this.strategyDir, name);
      try {
        const content = this.fs.readFileSync(filePath, 'utf-8');
        const dag = parseStrategyYaml(content);
        // Verify the strategy ID matches what was requested
        if (dag.id === id) {
          return dag;
        }
        // ID mismatch — file found but strategy.id differs; keep scanning
      } catch {
        // File not found or parse error — try next candidate
      }
    }

    // If not found by filename, scan all YAML files for matching strategy.id
    // This handles cases where the file name does not match the strategy ID.
    let entries: string[];
    try {
      const dirEntries = this.fs.readdirSync(this.strategyDir);
      entries = dirEntries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'));
    } catch {
      // Directory does not exist or is not readable
      return null;
    }

    for (const entry of entries) {
      // Skip candidates already tried above
      if (candidateNames.includes(entry)) continue;

      const filePath = join(this.strategyDir, entry);
      try {
        const content = this.fs.readFileSync(filePath, 'utf-8');
        const dag = parseStrategyYaml(content);
        if (dag.id === id) {
          return dag;
        }
      } catch {
        // Malformed YAML or not a strategy file — skip
      }
    }

    return null;
  }
}
