import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { createSession, getSession, insertEvent } from '../runtime/session.js';
import { renderGuidance } from '../runtime/guidance.js';

export function registerStart(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_start',
    'Start a methodology session. Returns a session_id and the guidance for Phase 0. Read the guidance carefully and execute the phase before calling method_advance.',
    {
      name: z.string().describe('Methodology name (from method_list)'),
      topic: z.string().describe('The topic or objective for this session'),
      project: z.string().optional().describe('Project slug to associate this session with (auto-created if new)'),
    },
    async ({ name, topic, project }) => {
      const methodology = methodologies.get(name);
      if (!methodology) {
        const available = Array.from(methodologies.keys()).join(', ');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'methodology_not_found',
                message: `No methodology named "${name}". Available: ${available}`,
              }),
            },
          ],
        };
      }

      const context: Record<string, unknown> = { topic };
      const sessionId = await createSession(methodology, context, project);
      await insertEvent(sessionId, 0, 'session_started', { topic, methodology: name });
      const session = await getSession(sessionId);
      const phase0 = methodology.phases[0];

      if (!phase0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid_methodology', message: 'Methodology has no phases' }),
            },
          ],
        };
      }

      const guidance = renderGuidance(phase0, context, session.total_phases);

      const result = {
        session_id: sessionId,
        methodology: methodology.name,
        status: session.status,
        current_phase: session.current_phase,
        current_phase_name: phase0.name,
        total_phases: session.total_phases,
        delta: session.delta,
        guidance,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
