/**
 * query command — semantic context retrieval.
 */

import type { ContextQueryPort, ContextQueryRequest } from '../../ports/context-query.js';

export async function runQueryCommand(
  queryPort: ContextQueryPort,
  request: ContextQueryRequest,
): Promise<void> {
  const result = await queryPort.query(request);
  const output = {
    mode: result.mode,
    results: result.results.map((c) => ({
      path: c.path,
      level: c.level,
      relevanceScore: Math.round(c.relevanceScore * 100) / 100,
      coverageScore: Math.round(c.coverageScore * 100) / 100,
      parts: c.parts.map((p) => p.part),
    })),
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
