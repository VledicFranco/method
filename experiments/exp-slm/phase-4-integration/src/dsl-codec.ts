/**
 * DSL Codec — encode AggregatedSignals to compact training format,
 * decode DSL output back to MonitorReport.
 *
 * The SLM was trained on this specific format (see phase-2-dsl corpus).
 *
 * Input format:
 *   SIGNALS:
 *   [reasoner:reasoner] conf=0.92 effort=low
 *   [actor:actor] action=Edit ok=True
 *
 * Output DSL format:
 *   ANOMALIES: none
 *   ESCALATE: none
 *   RESTRICT: none
 *   REPLAN: no
 */

import type {
  AggregatedSignals,
  MonitorReport,
  Anomaly,
} from '../../phase-1-llm-monitor/src/types.js';
import { moduleId } from '../../phase-1-llm-monitor/src/types.js';

// ── Encode: AggregatedSignals → compact training format ───────

export function encodeSignals(signals: AggregatedSignals): string {
  if (signals.size === 0) {
    return 'SIGNALS:\n(none)';
  }

  const parts: string[] = ['SIGNALS:'];

  for (const [id, signal] of signals) {
    const s: Record<string, unknown> = { ...signal };
    const tokens: string[] = [];

    if (s['type'] === 'reasoner' || s['type'] === 'reasoner-actor') {
      if (typeof s['confidence'] === 'number') tokens.push(`conf=${s['confidence']}`);
      if (s['conflictDetected'] === true) tokens.push('conflict');
      if (typeof s['effortLevel'] === 'string') tokens.push(`effort=${s['effortLevel']}`);
      if (typeof s['tokensThisStep'] === 'number') tokens.push(`tokens=${s['tokensThisStep']}`);
    }

    if (s['type'] === 'actor' || s['type'] === 'reasoner-actor') {
      if (typeof s['actionTaken'] === 'string') tokens.push(`action=${s['actionTaken']}`);
      if (typeof s['success'] === 'boolean') tokens.push(`ok=${s['success'] ? 'True' : 'False'}`);
      if (s['unexpectedResult'] === true) tokens.push('unexpected');
    }

    if (s['type'] === 'observer') {
      if (typeof s['inputProcessed'] === 'boolean') tokens.push(`processed=${s['inputProcessed'] ? 'True' : 'False'}`);
      if (typeof s['noveltyScore'] === 'number') tokens.push(`novelty=${s['noveltyScore']}`);
    }

    if (s['type'] === 'memory') {
      if (typeof s['retrievalCount'] === 'number') tokens.push(`retrievals=${s['retrievalCount']}`);
      if (typeof s['relevanceScore'] === 'number') tokens.push(`relevance=${s['relevanceScore']}`);
    }

    if (s['type'] === 'evaluator') {
      if (typeof s['estimatedProgress'] === 'number') tokens.push(`progress=${s['estimatedProgress']}`);
      if (s['diminishingReturns'] === true) tokens.push('diminishing');
    }

    if (s['type'] === 'planner') {
      if (typeof s['planRevised'] === 'boolean') tokens.push(`revised=${s['planRevised'] ? 'True' : 'False'}`);
      if (typeof s['subgoalCount'] === 'number') tokens.push(`subgoals=${s['subgoalCount']}`);
    }

    const type = typeof s['type'] === 'string' ? s['type'] : String(id);
    parts.push(`[${type}:${id}] ${tokens.join(' ')}`);
  }

  return parts.join('\n');
}

// ── Decode: DSL text → MonitorReport ──────────────────────────

export function parseDsl(dsl: string): MonitorReport | null {
  try {
    const lines = dsl.trim().split('\n');
    const anomalies: Anomaly[] = [];
    let escalation: string | undefined;
    const restrictedActions: string[] = [];
    let forceReplan = false;

    let section: 'anomalies' | 'escalate' | 'restrict' | 'replan' | null = null;

    for (const raw of lines) {
      const line = raw.trim();

      // Section headers
      if (line.startsWith('ANOMALIES:')) {
        const rest = line.slice('ANOMALIES:'.length).trim();
        if (rest === 'none' || rest === '') {
          section = 'anomalies';
        } else {
          section = 'anomalies';
        }
        continue;
      }
      if (line.startsWith('ESCALATE:')) {
        const rest = line.slice('ESCALATE:'.length).trim();
        if (rest === 'none') {
          escalation = undefined;
        } else if (rest.startsWith('"') && rest.endsWith('"')) {
          escalation = rest.slice(1, -1);
        } else if (rest.length > 0) {
          escalation = rest;
        }
        section = 'escalate';
        continue;
      }
      if (line.startsWith('RESTRICT:')) {
        const rest = line.slice('RESTRICT:'.length).trim();
        if (rest !== 'none' && rest.length > 0) {
          for (const a of rest.split(',')) {
            const trimmed = a.trim();
            if (trimmed) restrictedActions.push(trimmed);
          }
        }
        section = 'restrict';
        continue;
      }
      if (line.startsWith('REPLAN:')) {
        const rest = line.slice('REPLAN:'.length).trim();
        forceReplan = rest === 'yes';
        section = 'replan';
        continue;
      }

      // Anomaly entries: @moduleId type "detail"
      if (section === 'anomalies' && line.startsWith('@')) {
        const match = line.match(
          /^@(\S+)\s+(low-confidence|unexpected-result|compound)\s+"(.+)"$/,
        );
        if (match) {
          anomalies.push({
            moduleId: moduleId(match[1]),
            type: match[2] as Anomaly['type'],
            detail: match[3],
          });
        }
      }
    }

    return { anomalies, escalation, restrictedActions, forceReplan };
  } catch {
    return null;
  }
}
