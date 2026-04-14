/**
 * Bridge-side shim for the runtime's cognitive sink.
 *
 * PRD-057 / S2 §14 Q6 / C5: `CognitiveSink` was renamed to
 * `CognitiveEventBusSink` in `@method/runtime/sessions`. This shim
 * preserves the legacy identifier so existing bridge-internal callers
 * (`server-entry.ts`, `domains/sessions/pool.ts`, `domains/experiments`)
 * compile unchanged. The alias is removed in C7.
 */

export {
  CognitiveEventBusSink,
  CognitiveEventBusSink as CognitiveSink,
} from '@method/runtime/sessions';
export type { CognitiveEventContext } from '@method/runtime/sessions';
