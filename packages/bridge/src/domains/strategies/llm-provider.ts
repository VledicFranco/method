/**
 * PRD 024 (MG-7): Re-export from ports for backward compatibility.
 *
 * The canonical definitions now live in ../../ports/llm-provider.ts.
 * Existing consumers within the strategies domain can continue importing
 * from this file without breaking.
 */
export type {
  LlmRequest,
  LlmUsage,
  LlmResponse,
  LlmStreamEvent,
  LlmProvider,
} from '../../ports/llm-provider.js';
