import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { getSession, advanceSession, completeSession, insertEvent } from '../runtime/session.js';
import { renderGuidance } from '../runtime/guidance.js';
import { validateOutput } from '../runtime/validator.js';

export function registerAdvance(server: McpServer, methodologies: Map<string, Methodology>): void {
  server.tool(
    'method_advance',
    'Submit structured output for the current phase. The server validates your output against the phase invariants. If validation fails, the session stays on the current phase and guidance is repeated. If validation passes, the next phase guidance is returned. Call method_status if you need a reminder of the current phase.',
    {
      session_id: z.string().describe('Session ID from method_start'),
      phase_output: z
        .record(z.string(), z.unknown())
        .describe(
          'Structured output for the current phase. Fields must match the current phase output_schema. Check the guidance from method_start or the previous method_advance call to know what fields are required.',
        ),
    },
    async ({ session_id, phase_output }) => {
      // Get session
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
                message: `No session with id "${session_id}". Call method_start to create a session.`,
              }),
            },
          ],
        };
      }

      // Check session is still active
      if (session.status === 'complete') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'session_complete',
                message: `Session "${session_id}" is already complete.`,
              }),
            },
          ],
        };
      }

      // Get methodology and current phase
      const methodology = methodologies.get(session.methodology);
      if (!methodology) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'internal_error',
                message: `Methodology "${session.methodology}" not found in loaded methodologies.`,
              }),
            },
          ],
        };
      }

      const currentPhase = methodology.phases[session.current_phase];
      if (!currentPhase) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'internal_error',
                message: `Phase ${session.current_phase} not found in methodology "${session.methodology}".`,
              }),
            },
          ],
        };
      }

      // Validate phase output
      const output = phase_output as Record<string, unknown>;
      const validation = validateOutput(currentPhase, output);

      // Validation failed
      if (!validation.passed) {
        await insertEvent(session_id, session.current_phase, 'validation_failed', { failed_invariants: validation.failed_hard });
        const guidance = renderGuidance(currentPhase, session.context, session.total_phases);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'phase_invariant_failed',
                  current_phase: session.current_phase,
                  current_phase_name: currentPhase.name,
                  failed_invariants: validation.failed_hard,
                  soft_warnings: validation.failed_soft,
                  message: `Phase ${session.current_phase} (${currentPhase.name}) has ${validation.failed_hard.length} unmet requirement(s). Fix the issues and resubmit.`,
                  guidance,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const isFinalPhase = session.current_phase === session.total_phases - 1;
      // ⚠️ Compute next phase index BEFORE advancing (session object will be stale after DB update)
      const nextPhaseIndex = session.current_phase + 1;

      // Fire phase_advanced event before DB write (currentPhase is still valid here)
      await insertEvent(session_id, session.current_phase, 'phase_advanced', { phase_name: currentPhase.name });

      // Advance session
      await advanceSession(session_id, output);

      if (isFinalPhase) {
        await completeSession(session_id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  session_complete: true,
                  methodology: session.methodology,
                  delta: 1.0,
                  status: 'complete',
                  soft_warnings: validation.failed_soft,
                  message: `All ${session.total_phases} phases complete. Session closed.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Non-final: deliver next phase guidance
      const nextPhase = methodology.phases[nextPhaseIndex];
      if (!nextPhase) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'internal_error',
                message: `Next phase not found after advancing.`,
              }),
            },
          ],
        };
      }

      const nextGuidance = renderGuidance(nextPhase, session.context, session.total_phases);
      // Read updated delta from DB for accuracy
      const updatedSession = await getSession(session_id);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                advanced_to_phase: nextPhaseIndex,
                current_phase_name: nextPhase.name,
                delta: updatedSession.delta,
                status: updatedSession.status,
                invariants_passed: currentPhase.invariants
                  .filter((inv) => inv.hard)
                  .map((inv) => inv.id),
                soft_warnings: validation.failed_soft,
                guidance: nextGuidance,
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
