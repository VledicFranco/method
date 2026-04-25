// SPDX-License-Identifier: Apache-2.0
/**
 * TraceAssembler — stateful TraceEvent → CycleTrace accumulator.
 *
 * Events are fed one-by-one via {@link TraceAssembler.feed}. Buffers them
 * keyed on `cycleId`. When a `cycle-end` event arrives, the buffered events
 * for that cycle are popped and assembled into a {@link CycleTrace}.
 *
 * Graceful degradation: if `cycle-start` is missing (partial trace), the
 * assembler uses the first event's timestamp as `startedAt` and an empty
 * `inputText`. Same fallback for missing `cycle-end` — though that's
 * unreachable through `feed()` since assembly is triggered by `cycle-end`.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Wave 1, C-1)
 */

import type { TraceEvent } from '../algebra/trace-events.js';
import type { MonitoringSignal } from '../algebra/module.js';
import type {
  CycleTrace,
  OperationTrace,
  PhaseTrace,
} from '../algebra/trace-cycle.js';
import type { TokenUsage } from '../../pact.js';

export class TraceAssembler {
  private readonly pending = new Map<string, TraceEvent[]>();

  /** Cycle ids currently accumulating events (diagnostic). */
  pendingCycleIds(): readonly string[] {
    return Array.from(this.pending.keys());
  }

  /**
   * Feed an event. When the event is `cycle-end`, returns the assembled
   * `CycleTrace` and clears that cycle's buffer; otherwise returns `null`
   * and buffers the event.
   */
  feed(event: TraceEvent): CycleTrace | null {
    const list = this.pending.get(event.cycleId) ?? [];
    list.push(event);
    this.pending.set(event.cycleId, list);

    if (event.kind === 'cycle-end') {
      const buffered = this.pending.get(event.cycleId) ?? list;
      this.pending.delete(event.cycleId);
      return assembleCycle(buffered);
    }
    return null;
  }
}

// ── Pure helpers ────────────────────────────────────────────────

function assembleCycle(events: readonly TraceEvent[]): CycleTrace {
  // Find bookend events
  let cycleStart: TraceEvent | undefined;
  let cycleEnd: TraceEvent | undefined;
  for (const ev of events) {
    if (ev.kind === 'cycle-start') cycleStart = ev;
    else if (ev.kind === 'cycle-end') cycleEnd = ev;
  }

  const startedAt = cycleStart?.timestamp ?? events[0]?.timestamp ?? 0;
  const endedAt = cycleEnd?.timestamp ?? events[events.length - 1]?.timestamp ?? startedAt;
  const durationMs = Math.max(0, endedAt - startedAt);

  const cycleId = events[0]?.cycleId ?? '';
  const cycleNumberRaw = cycleStart?.data?.['cycleNumber'];
  const cycleNumber = typeof cycleNumberRaw === 'number' ? cycleNumberRaw : 0;

  const inputText = readString(cycleStart?.data, 'inputText');
  const outputText = readString(cycleEnd?.data, 'outputText');

  const phases = assemblePhases(events);

  // All signals across all phases, plus any cycle-level signals on bookend events.
  const signals: MonitoringSignal[] = [];
  for (const phase of phases) signals.push(...phase.signals);
  if (cycleStart?.signals) signals.push(...cycleStart.signals);
  if (cycleEnd?.signals) signals.push(...cycleEnd.signals);

  // Aggregate tokens across operations. Per-operation `model` lives on
  // OperationTrace.metadata, not on the aggregate; the aggregate matches
  // the canonical pact TokenUsage shape.
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  for (const phase of phases) {
    for (const op of phase.operations) {
      const meta = op.metadata ?? {};
      totalInput += readNumber(meta, 'inputTokens');
      totalOutput += readNumber(meta, 'outputTokens');
      totalCacheRead += readNumber(meta, 'cacheReadTokens');
      totalCacheWrite += readNumber(meta, 'cacheWriteTokens');
    }
  }
  let tokenUsage: TokenUsage | undefined;
  if (totalInput > 0 || totalOutput > 0 || totalCacheRead > 0 || totalCacheWrite > 0) {
    tokenUsage = {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      totalTokens: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    };
  }

  return {
    cycleId,
    cycleNumber,
    startedAt,
    endedAt,
    durationMs,
    inputText,
    outputText,
    phases,
    signals,
    tokenUsage,
    workspaceSnapshot: undefined,
  };
}

function assemblePhases(events: readonly TraceEvent[]): readonly PhaseTrace[] {
  const phaseMap = new Map<string, TraceEvent[]>();
  const phaseOrder: string[] = [];

  for (const ev of events) {
    if (ev.phase === undefined) continue;
    if (
      ev.kind !== 'phase-start' &&
      ev.kind !== 'phase-end' &&
      ev.kind !== 'operation'
    ) {
      continue;
    }
    if (!phaseMap.has(ev.phase)) {
      phaseMap.set(ev.phase, []);
      phaseOrder.push(ev.phase);
    }
    phaseMap.get(ev.phase)!.push(ev);
  }

  const phases: PhaseTrace[] = [];
  for (const phaseName of phaseOrder) {
    const pevents = phaseMap.get(phaseName)!;
    let phaseStart: TraceEvent | undefined;
    let phaseEnd: TraceEvent | undefined;
    const operations: OperationTrace[] = [];
    const signals: MonitoringSignal[] = [];

    for (const ev of pevents) {
      if (ev.kind === 'phase-start') {
        phaseStart = ev;
      } else if (ev.kind === 'phase-end') {
        phaseEnd = ev;
        if (ev.signals) signals.push(...ev.signals);
      } else if (ev.kind === 'operation') {
        operations.push({
          operation: readString(ev.data, 'operation') || ev.name,
          startedAt: ev.timestamp,
          durationMs: ev.durationMs ?? readNumber(ev.data, 'durationMs'),
          metadata: ev.data,
        });
      }
    }

    const startedAt = phaseStart?.timestamp ?? pevents[0]?.timestamp ?? 0;
    const endedAt = phaseEnd?.timestamp ?? pevents[pevents.length - 1]?.timestamp ?? startedAt;
    const durationMs = phaseEnd?.durationMs ?? Math.max(0, endedAt - startedAt);

    const inputSummary = readString(phaseStart?.data, 'inputSummary');
    const outputSummary = readString(phaseEnd?.data, 'outputSummary');
    const errorRaw = phaseEnd?.data?.['error'];
    const error = typeof errorRaw === 'string' ? errorRaw : undefined;

    phases.push({
      phase: phaseName,
      startedAt,
      endedAt,
      durationMs,
      inputSummary,
      outputSummary,
      operations,
      signals,
      error,
    });
  }

  return phases;
}

function readString(data: Readonly<Record<string, unknown>> | undefined, key: string): string {
  const v = data?.[key];
  return typeof v === 'string' ? v : '';
}

function readNumber(
  data: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number {
  const v = data?.[key];
  return typeof v === 'number' ? v : 0;
}
