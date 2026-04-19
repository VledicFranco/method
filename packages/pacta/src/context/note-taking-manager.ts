// SPDX-License-Identifier: Apache-2.0
/**
 * Note-Taking Manager — uses MemoryPort to store and retrieve notes.
 *
 * Before each turn: retrieves relevant notes from memory and prepends
 * them to the request prompt. After each turn: extracts key observations
 * from the result and stores them as notes.
 *
 * Strategy: 'notes' in ContextPolicy.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { MemoryPort, AgentNote } from '../ports/memory-port.js';
import type { ContextPolicy } from './context-policy.js';
import type { InvokeFn, ContextMiddleware } from './context-middleware.js';

const DEFAULT_NOTE_LIMIT = 10;
const NOTE_HEADER = '[RETRIEVED NOTES]\n';

/**
 * Formats retrieved notes into a string that can be prepended to the prompt.
 */
function formatNotes(notes: AgentNote[]): string {
  if (notes.length === 0) return '';
  const lines = notes.map((n, i) => `${i + 1}. ${n.content}`);
  return `${NOTE_HEADER}${lines.join('\n')}\n\n`;
}

/**
 * Creates a context middleware that stores and retrieves notes via MemoryPort.
 *
 * Requires policy.memory to be set. If memory is not provided, the middleware
 * passes through without modification.
 *
 * @param policy - Context policy configuration (optional).
 * @returns A ContextMiddleware that wraps provider.invoke().
 */
export function noteTakingManager(policy?: Partial<ContextPolicy>): ContextMiddleware {
  const memory: MemoryPort | undefined = policy?.memory;

  return <T>(
    inner: InvokeFn<T>,
    pact: Pact<T>,
    onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    if (!memory) {
      // No memory port — pass through
      return inner;
    }

    let turnNumber = 0;

    return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
      turnNumber++;

      // Before turn: retrieve relevant notes
      let enrichedRequest = request;
      if (memory.readNotes) {
        const notes = await memory.readNotes({ limit: DEFAULT_NOTE_LIMIT });
        if (notes.length > 0) {
          const prefix = formatNotes(notes);
          enrichedRequest = {
            ...request,
            prompt: `${prefix}${request.prompt}`,
          };
        }
      }

      // Invoke the inner pipeline
      const result = await inner(p, enrichedRequest);

      // After turn: store key observation as a note
      if (memory.writeNote && result.completed) {
        const note: AgentNote = {
          content: `Turn ${turnNumber}: ${typeof result.output === 'string' ? result.output.slice(0, 200) : JSON.stringify(result.output).slice(0, 200)}`,
          timestamp: new Date().toISOString(),
          tags: ['auto', `turn-${turnNumber}`],
        };
        await memory.writeNote(note);
      }

      return result;
    };
  };
}
