/**
 * scan command — triggers a full project scan and index.
 */

import { Indexer } from '../indexer.js';

export interface ScanCommandOptions {
  projectRoot: string;
  verbose?: boolean;
}

export async function runScanCommand(
  indexer: Indexer,
  options: ScanCommandOptions,
): Promise<void> {
  const { componentCount } = await indexer.index(options.projectRoot);
  if (options.verbose) {
    process.stdout.write(`Indexed ${componentCount} components.\n`);
  }
}
