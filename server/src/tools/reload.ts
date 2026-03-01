import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { reloadMethodologies } from '../runtime/loader.js';

export function registerReload(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_reload',
    'Reload all methodology YAML files from disk without restarting the server. Call this after adding or modifying a methodology file. Returns the names of successfully loaded methodologies and any validation errors.',
    {},
    async () => {
      const { loaded, errors } = reloadMethodologies(methodologies);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                loaded,
                total: loaded.length,
                errors,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
