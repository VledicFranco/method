import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { getSession } from '../runtime/session.js';

export function registerStatus(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_status',
    'Get the current state of a methodology session. Returns phase progress, delta, and completed phases. Useful if you need to recall where you are in a session.',
    {
      session_id: z.string().describe('Session ID from method_start'),
    },
    async ({ session_id }) => {
      let session;
      try {
        session = await getSession(session_id);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'session_not_found',
                message: `No session with id "${session_id}".`,
              }),
            },
          ],
        };
      }

      const methodology = methodologies.get(session.methodology);
      const currentPhaseName =
        session.status === 'complete'
          ? 'complete'
          : (methodology?.phases[session.current_phase]?.name ?? 'unknown');

      const result = {
        session_id,
        methodology: session.methodology,
        status: session.status,
        current_phase: session.current_phase,
        current_phase_name: currentPhaseName,
        total_phases: session.total_phases,
        delta: session.delta,
        completed_phases: session.completed_phases,
        context: session.context,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
