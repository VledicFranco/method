/**
 * Assertion helpers used by the built-in S1/S3 conformance plugins.
 * Each helper takes a `CheckVerdict`-building context (id, description,
 * fixtureId) and returns a `CheckVerdict` — never throws.
 */

import type { CallRecorder, RecordedCtxCall } from './mock-cortex-ctx.js';
import type { CheckVerdict } from './compliance-report.js';
import type { FixtureId } from './fixtures/index.js';

export interface CheckContext {
  readonly id: string;
  readonly description: string;
  readonly fixtureId: FixtureId;
}

export function pass(ctx: CheckContext): CheckVerdict {
  return { ...ctx, passed: true };
}

export function fail(ctx: CheckContext, evidence: string): CheckVerdict {
  return { ...ctx, passed: false, evidence };
}

export function skip(ctx: CheckContext, reason: string): CheckVerdict {
  return { ...ctx, passed: true, evidence: `skipped — ${reason}` };
}

/** Max `delegationDepth` observed across `ctx.auth.exchangeForAgent` calls. */
export function maxDelegationDepth(recorder: CallRecorder): number {
  let max = 0;
  for (const c of recorder.where('auth')) {
    if (c.method === 'exchangeForAgent') {
      const result = c.result as { token?: string } | undefined;
      if (result && typeof result.token === 'string') {
        const match = /^ext-token-d(\d+)$/.exec(result.token);
        if (match) {
          const n = Number.parseInt(match[1]!, 10);
          if (n > max) max = n;
        }
      }
    }
  }
  return max;
}

/** Collect audit kinds actually emitted (reads both `kind` and `eventType`). */
export function auditKinds(recorder: CallRecorder): ReadonlyArray<string> {
  const out: string[] = [];
  for (const c of recorder.where('audit')) {
    const kind = (c.args.kind as string | undefined) ?? (c.args.eventType as string | undefined);
    if (kind) out.push(kind);
  }
  return out;
}

/**
 * For every `llm.complete` call, enumerate the tools the scripted turn
 * "requested" (captured in `args.toolsRequested` by the mock llm facade).
 */
export function toolsRequestedAcrossCalls(
  recorder: CallRecorder,
): ReadonlyArray<string> {
  const out: string[] = [];
  for (const c of recorder.where('llm')) {
    if (c.method !== 'complete') continue;
    const tools = c.args.toolsRequested as ReadonlyArray<string> | undefined;
    if (tools) out.push(...tools);
  }
  return out;
}

/** True iff the recorder contains at least one `llm.registerBudgetHandlers` call. */
export function budgetHandlersRegistered(recorder: CallRecorder): boolean {
  return recorder.where('llm').some((c) => c.method === 'registerBudgetHandlers');
}

/** True iff every `llm.complete` call has `args.handlersRegistered === true`. */
export function everyCompleteHasHandlers(recorder: CallRecorder): boolean {
  const completes = recorder.where('llm').filter((c) => c.method === 'complete');
  if (completes.length === 0) return false;
  return completes.every((c) => c.args.handlersRegistered === true);
}

/** Convenience: filter audit kinds against a required set (subset match). */
export function missingAuditKinds(
  actual: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const set = new Set(actual);
  return required.filter((k) => !set.has(k));
}

/** Utility — first recorded call matching predicate, or undefined. */
export function firstCall(
  recorder: CallRecorder,
  pred: (c: RecordedCtxCall) => boolean,
): RecordedCtxCall | undefined {
  const idx = recorder.firstIndexOf(pred);
  if (idx < 0) return undefined;
  return recorder.calls[idx];
}
