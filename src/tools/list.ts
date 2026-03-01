import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';

export function registerList(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_list',
    'List all available methodologies with their names, descriptions, and phase counts. Call this first to discover what methodologies are available before calling method_start.',
    {},
    async () => {
      const result = {
        methodologies: Array.from(methodologies.values()).map((m) => ({
          name: m.name,
          description: m.description,
          phases: m.phases.length,
          phase_names: m.phases.map((p) => `${p.id}: ${p.name}`),
        })),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
