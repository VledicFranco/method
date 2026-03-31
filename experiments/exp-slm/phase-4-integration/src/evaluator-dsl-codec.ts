/**
 * Evaluator DSL Codec — encode EvaluatorSignalInput[] to compact training format,
 * decode DSL output back to EvaluatorReport.
 *
 * The SLM was trained on this specific format (see phase-2-dsl corpus).
 *
 * Input format:
 *   EVAL-SIGNALS:
 *   [evaluator:main] progress=0.37 diminishing=True steps=7 clarity=low
 *   [evaluator:aux] progress=0.32 diminishing=False steps=3 clarity=high
 *
 * Output DSL format:
 *   PROGRESS: on-track | stagnant | diverging
 *   CONFIDENCE: 0.72
 *   ACTION: continue | replan | escalate
 *   NOTE: "text" | none
 */

import type {
  EvaluatorSignalInput,
  EvaluatorReport,
  EvaluatorProgress,
  EvaluatorAction,
} from './evaluator-types.js';

// ── Valid values (mirrors shared/metrics/accuracy.py) ────────

const VALID_PROGRESS = new Set<EvaluatorProgress>(['on-track', 'stagnant', 'diverging']);
const VALID_ACTION = new Set<EvaluatorAction>(['continue', 'replan', 'escalate']);

// ── Encode: EvaluatorSignalInput[] → compact training format ─

export function encodeEvaluatorSignals(signals: EvaluatorSignalInput[]): string {
  if (signals.length === 0) {
    return 'EVAL-SIGNALS:\n(none)';
  }

  const parts: string[] = ['EVAL-SIGNALS:'];

  for (const s of signals) {
    const progressStr = s.progress.toFixed(2);
    const dimStr = s.diminishing ? 'True' : 'False';
    parts.push(
      `[evaluator:${s.id}] progress=${progressStr} diminishing=${dimStr} steps=${s.steps} clarity=${s.clarity}`,
    );
  }

  return parts.join('\n');
}

// ── Decode: DSL text → EvaluatorReport ───────────────────────

export function parseEvaluatorDsl(dsl: string): EvaluatorReport | null {
  try {
    return parseStrict(dsl);
  } catch {
    return null;
  }
}

function parseStrict(dsl: string): EvaluatorReport {
  const lines = dsl.trim().split('\n');
  let progress: EvaluatorProgress | undefined;
  let confidence: number | undefined;
  let action: EvaluatorAction | undefined;
  let note: string | null | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('PROGRESS: ')) {
      const val = line.slice('PROGRESS: '.length).trim();
      if (!VALID_PROGRESS.has(val as EvaluatorProgress)) {
        throw new Error(`Invalid PROGRESS: ${val}`);
      }
      progress = val as EvaluatorProgress;
    } else if (line.startsWith('CONFIDENCE: ')) {
      const parsed = parseFloat(line.slice('CONFIDENCE: '.length).trim());
      if (isNaN(parsed)) {
        throw new Error(`Invalid CONFIDENCE: ${line}`);
      }
      confidence = parsed;
    } else if (line.startsWith('ACTION: ')) {
      const val = line.slice('ACTION: '.length).trim();
      if (!VALID_ACTION.has(val as EvaluatorAction)) {
        throw new Error(`Invalid ACTION: ${val}`);
      }
      action = val as EvaluatorAction;
    } else if (line.startsWith('NOTE: ')) {
      const val = line.slice('NOTE: '.length).trim();
      note = parseNote(val);
    } else {
      throw new Error(`Unexpected line: ${line}`);
    }
  }

  if (progress === undefined) throw new Error('Missing required field: progress');
  if (confidence === undefined) throw new Error('Missing required field: confidence');
  if (action === undefined) throw new Error('Missing required field: action');

  return {
    progress,
    confidence,
    action,
    note: note ?? null,
  };
}

function parseNote(value: string): string | null {
  if (value === 'none') return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  // Tolerate unquoted notes
  return value;
}
