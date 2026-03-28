/**
 * LLM Monitor v2 — system and user prompt construction.
 *
 * The system prompt instructs the LLM to act as a cognitive cycle monitor,
 * analyzing aggregated monitoring signals and producing a structured JSON
 * MonitorReport. The user prompt serializes AggregatedSignals into a
 * readable format the LLM can analyze.
 */

import type { AggregatedSignals, MonitoringSignal, ModuleId } from './types.js';

// ── System Prompt ───────────────────────────────────────────────

export const MONITOR_SYSTEM_PROMPT = `You are a metacognitive monitor for a cognitive cycle engine. Your role is to analyze monitoring signals from object-level cognitive modules (reasoner, actor, observer, memory, etc.) and detect anomalies that require escalation or intervention.

You will receive aggregated monitoring signals from the most recent cycle. Each signal comes from a named module and contains performance metrics.

Analyze the signals and produce a JSON response with exactly this structure:

{
  "anomalies": [
    {
      "moduleId": "<source module id>",
      "type": "low-confidence" | "unexpected-result" | "compound",
      "detail": "<human-readable description of the anomaly>"
    }
  ],
  "escalation": "<string describing what to escalate, or null if none>",
  "restrictedActions": ["<action types to block in the next cycle>"],
  "forceReplan": <true if the agent should abandon its current strategy and replan>
}

Anomaly detection rules:
- "low-confidence": Flag when a reasoner's confidence is below 0.3, or when stagnation is detected (repeated read-only cycles with identical inputs).
- "unexpected-result": Flag when an actor reports an unexpected result (success=false or unexpectedResult=true).
- "compound": Flag when BOTH low-confidence AND unexpected-result anomalies are present for the same cycle. Compound anomalies always warrant escalation.

Escalation rules:
- Set escalation to a descriptive string when compound anomalies are detected.
- Set escalation to null when no compound anomalies exist.

Restricted actions:
- If stagnation is detected (consecutive read-only cycles), restrict the stagnating action type.
- Otherwise, return an empty array.

Force replan:
- Set to true only when severe stagnation or unrecoverable compound anomalies are detected.
- Default to false.

IMPORTANT: Respond ONLY with valid JSON matching the schema above. No markdown, no explanation, no wrapping.`;

// ── User Prompt Builder ─────────────────────────────────────────

/**
 * Serialize AggregatedSignals into a readable format for LLM analysis.
 *
 * Produces a structured text block with one section per module signal,
 * including all available fields for that signal type.
 */
export function buildMonitorUserPrompt(signals: AggregatedSignals): string {
  if (signals.size === 0) {
    return 'No monitoring signals were collected this cycle. All modules either did not execute or produced no monitoring output.\n\nAnalyze this absence and produce a MonitorReport.';
  }

  const parts: string[] = [
    `Cognitive cycle monitoring signals (${signals.size} module(s) reporting):`,
    '',
  ];

  for (const [sourceId, signal] of signals) {
    parts.push(`--- Module: ${sourceId} ---`);
    parts.push(formatSignal(sourceId, signal));
    parts.push('');
  }

  parts.push('Analyze these signals and produce a MonitorReport JSON response.');

  return parts.join('\n');
}

// ── Signal Formatter ────────────────────────────────────────────

function formatSignal(sourceId: ModuleId, signal: MonitoringSignal): string {
  const lines: string[] = [];
  const s: Record<string, unknown> = { ...signal };

  // Common fields
  lines.push(`  source: ${sourceId}`);
  lines.push(`  timestamp: ${signal.timestamp}`);

  if ('type' in s) {
    lines.push(`  type: ${s['type']}`);
  }

  // Reasoner-specific
  if (s['type'] === 'reasoner' || s['type'] === 'reasoner-actor') {
    if ('confidence' in s) lines.push(`  confidence: ${s['confidence']}`);
    if ('conflictDetected' in s) lines.push(`  conflictDetected: ${s['conflictDetected']}`);
    if ('effortLevel' in s) lines.push(`  effortLevel: ${s['effortLevel']}`);
    if ('tokensThisStep' in s) lines.push(`  tokensThisStep: ${s['tokensThisStep']}`);
  }

  // Actor-specific
  if (s['type'] === 'actor' || s['type'] === 'reasoner-actor') {
    if ('actionTaken' in s) lines.push(`  actionTaken: ${s['actionTaken']}`);
    if ('success' in s) lines.push(`  success: ${s['success']}`);
    if ('unexpectedResult' in s) lines.push(`  unexpectedResult: ${s['unexpectedResult']}`);
    if ('declaredPlanAction' in s) lines.push(`  declaredPlanAction: ${s['declaredPlanAction']}`);
  }

  // Observer-specific
  if (s['type'] === 'observer') {
    if ('inputProcessed' in s) lines.push(`  inputProcessed: ${s['inputProcessed']}`);
    if ('noveltyScore' in s) lines.push(`  noveltyScore: ${s['noveltyScore']}`);
  }

  // Memory-specific
  if (s['type'] === 'memory') {
    if ('retrievalCount' in s) lines.push(`  retrievalCount: ${s['retrievalCount']}`);
    if ('relevanceScore' in s) lines.push(`  relevanceScore: ${s['relevanceScore']}`);
  }

  // Evaluator-specific
  if (s['type'] === 'evaluator') {
    if ('estimatedProgress' in s) lines.push(`  estimatedProgress: ${s['estimatedProgress']}`);
    if ('diminishingReturns' in s) lines.push(`  diminishingReturns: ${s['diminishingReturns']}`);
  }

  // Planner-specific
  if (s['type'] === 'planner') {
    if ('planRevised' in s) lines.push(`  planRevised: ${s['planRevised']}`);
    if ('subgoalCount' in s) lines.push(`  subgoalCount: ${s['subgoalCount']}`);
  }

  // Reflector-specific
  if (s['type'] === 'reflector') {
    if ('lessonsExtracted' in s) lines.push(`  lessonsExtracted: ${s['lessonsExtracted']}`);
  }

  // Monitor-specific (nested monitor signals)
  if (s['type'] === 'monitor') {
    if ('anomalyDetected' in s) lines.push(`  anomalyDetected: ${s['anomalyDetected']}`);
    if ('escalation' in s) lines.push(`  escalation: ${s['escalation']}`);
  }

  return lines.join('\n');
}
