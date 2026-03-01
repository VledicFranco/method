import { z } from 'zod';
import { parse } from 'yaml';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { MethodologySchema } from '../schema.js';
import { upsertMethodology } from '../runtime/loader.js';

export function registerImport(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_import',
    'Import a methodology from raw YAML content. Validates the YAML, persists it to the database, and makes it immediately available — no file required. Survives server restarts.',
    {
      yaml_content: z.string().describe('Raw YAML content of the methodology to import'),
    },
    async ({ yaml_content }) => {
      // Parse
      let parsed: unknown;
      try {
        parsed = parse(yaml_content);
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'yaml_parse_error',
                message: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }

      // Validate schema
      const result = MethodologySchema.safeParse(parsed);
      if (!result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'schema_validation_error',
                message: result.error.message,
              }),
            },
          ],
        };
      }

      // Persist to DB and update in-memory map
      await upsertMethodology(result.data);
      methodologies.set(result.data.name, result.data);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                imported: result.data.name,
                description: result.data.description,
                phases: result.data.phases.length,
                available: Array.from(methodologies.keys()).sort(),
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
