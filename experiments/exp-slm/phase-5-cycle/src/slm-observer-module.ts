/**
 * SLM Observer Module — SLM-backed Observer with rule-based fallback.
 *
 * The SLM Observer translates ObserverInput into ObserverSignalInput[],
 * encodes to DSL, runs SLM inference, parses the ObserverReport, and maps
 * it back to ObserverOutput. Falls back to inline rule-based logic when
 * the SLM fails to parse or confidence is too low.
 *
 * Unlike the rule-based observer (which fires only at cycle 0 in the baseline),
 * the SLM observer is designed to fire every cycle per design doc section 2.3.
 */

import type {
  CognitiveModule,
  ObserverMonitoring,
  StepResult,
  WorkspaceWritePort,
  WorkspaceEntry,
} from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import { moduleId } from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import type { ObserverInput, ObserverOutput, ObserverState, ObserverControl } from '../../../../packages/pacta/src/cognitive/modules/observer.js';
import type { SLMInference } from '../../phase-4-integration/src/slm-inference.js';
import { encodeObserverSignals, parseObserverDsl } from '../../phase-4-integration/src/observer-dsl-codec.js';
import { translateToObserverSignals, mapObserverReportToOutput } from './signal-translators.js';
import { classifyEntry } from '../../../../packages/pacta/src/cognitive/modules/constraint-classifier.js';

// ── Types ───────────────────────────────────────────────────────

export interface SLMObserverConfig {
  slm: SLMInference;
  /** SLM confidence below which we fall back to rule-based. Default: 0.4. */
  confidenceThreshold?: number;
  writePort: WorkspaceWritePort;
}

/** Extended metrics for SLM Observer invocations. */
interface SLMObserverMetrics {
  slmLatencyMs: number;
  slmConfidence: number;
  slmParseSuccess: boolean;
  usedFallback: boolean;
  slmInputTokens: number;
  slmOutputTokens: number;
}

// ── Factory ─────────────────────────────────────────────────────

export function createSLMObserver(
  config: SLMObserverConfig,
): CognitiveModule<ObserverInput, ObserverOutput, ObserverState, ObserverMonitoring, ObserverControl> & { lastMetrics?: SLMObserverMetrics } {
  const { slm, confidenceThreshold = 0.4, writePort } = config;
  const id = moduleId('observer');

  const mod: CognitiveModule<ObserverInput, ObserverOutput, ObserverState, ObserverMonitoring, ObserverControl> & { lastMetrics?: SLMObserverMetrics } = {
    id,
    lastMetrics: undefined,

    async step(
      input: ObserverInput,
      state: ObserverState,
      _control: ObserverControl,
    ): Promise<StepResult<ObserverOutput, ObserverState, ObserverMonitoring>> {
      let metrics: SLMObserverMetrics = {
        slmLatencyMs: 0,
        slmConfidence: 0,
        slmParseSuccess: false,
        usedFallback: true,
        slmInputTokens: 0,
        slmOutputTokens: 0,
      };

      try {
        // 1. Translate cognitive types to SLM codec types
        const signals = translateToObserverSignals(input, state);

        // 2. Encode to DSL
        const dslInput = encodeObserverSignals(signals);

        // 3. SLM inference
        const slmResult = await slm.generate(dslInput);
        metrics.slmLatencyMs = slmResult.latencyMs;
        metrics.slmConfidence = slmResult.confidence;
        metrics.slmInputTokens = slmResult.inputTokenCount;
        metrics.slmOutputTokens = slmResult.outputTokenCount;

        // 4. Parse DSL output
        const report = parseObserverDsl(slmResult.tokens);
        metrics.slmParseSuccess = report !== null;

        // 5. Confidence gate
        if (report !== null && slmResult.confidence >= confidenceThreshold) {
          metrics.usedFallback = false;
          mod.lastMetrics = metrics;

          // Map SLM output back to cognitive module output
          const output = mapObserverReportToOutput(report, input);

          // Write to workspace (same pattern as rule-based observer)
          const classification = classifyEntry(input.content);
          const entry: WorkspaceEntry & { contentType?: string } = {
            source: id,
            content: input.content,
            salience: report.novelty,
            timestamp: Date.now(),
            pinned: classification.pinned || undefined,
            contentType: classification.contentType,
          };
          writePort.write(entry);

          const newState: ObserverState = {
            observationCount: state.observationCount + 1,
            lastNoveltyScore: report.novelty,
            previousContent: input.content,
          };

          const monitoring: ObserverMonitoring = {
            type: 'observer',
            source: id,
            timestamp: Date.now(),
            inputProcessed: true,
            noveltyScore: report.novelty,
          };

          return { output, state: newState, monitoring };
        }
      } catch {
        // SLM call failed — fall through to fallback
      }

      // Fallback: inline rule-based observer logic
      metrics.usedFallback = true;
      mod.lastMetrics = metrics;

      return runFallbackObserver(input, state, writePort, id);
    },

    initialState(): ObserverState {
      return {
        observationCount: 0,
        lastNoveltyScore: 0,
        previousContent: null,
      };
    },
  };

  return mod;
}

// ── Fallback ────────────────────────────────────────────────────

/** Inline rule-based observer logic (mirrors observer.ts without creating a full module). */
function runFallbackObserver(
  input: ObserverInput,
  state: ObserverState,
  writePort: WorkspaceWritePort,
  id: ReturnType<typeof moduleId>,
): StepResult<ObserverOutput, ObserverState, ObserverMonitoring> {
  // Novelty: char-diff heuristic (same as observer.ts)
  const lengthScore = Math.min(0.9, Math.max(0.1, input.content.length / 500));
  let noveltyScore: number;

  if (state.previousContent === null) {
    noveltyScore = Math.max(0.5, lengthScore);
  } else {
    const maxLen = Math.max(input.content.length, state.previousContent.length);
    if (maxLen === 0) {
      noveltyScore = 0;
    } else {
      let diffCount = 0;
      for (let i = 0; i < maxLen; i++) {
        if (input.content[i] !== state.previousContent[i]) diffCount++;
      }
      noveltyScore = Math.min(1, (lengthScore + diffCount / maxLen) / 2);
    }
  }

  // Classify and write to workspace
  const classification = classifyEntry(input.content);
  const entry: WorkspaceEntry & { contentType?: string } = {
    source: id,
    content: input.content,
    salience: noveltyScore,
    timestamp: Date.now(),
    pinned: classification.pinned || undefined,
    contentType: classification.contentType,
  };
  writePort.write(entry);

  const newState: ObserverState = {
    observationCount: state.observationCount + 1,
    lastNoveltyScore: noveltyScore,
    previousContent: input.content,
  };

  const monitoring: ObserverMonitoring = {
    type: 'observer',
    source: id,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore,
  };

  return {
    output: { observation: input.content, noveltyScore, filtered: false },
    state: newState,
    monitoring,
  };
}
