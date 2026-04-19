// SPDX-License-Identifier: Apache-2.0
/**
 * Verifier — cybernetic verification module for action-outcome checking.
 *
 * After the Actor executes an action, the Verifier checks whether the action
 * achieved its intended outcome by running KPI predicates against the current
 * workspace state. Supports two verification modes:
 *
 * 1. **Programmatic:** KPIs with a `check()` predicate are evaluated directly
 *    against a VerificationState built from the workspace snapshot — zero LLM
 *    cost, deterministic, 100% reliable.
 *
 * 2. **LLM fallback:** KPIs without `check()` are batched into a single LLM
 *    call that assesses whether each KPI was satisfied by the last action.
 *    Falls back to verified=true when no provider is available.
 *
 * When verification fails, the module produces a CorrectionSignal with a
 * specific diagnosis and suggested fix. The signal is injected into the
 * workspace at high salience, so spreading activation surfaces it in the
 * next cycle's context — closing the cybernetic feedback loop.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Anterior Cingulate Cortex (ACC) — error monitoring
 * and conflict detection.**
 *
 * - **Botvinick et al. (2001) — Conflict Monitoring Theory:** The ACC
 *   detects discrepancies between intended and actual outcomes, generating
 *   an error signal that triggers compensatory adjustments. The Verifier
 *   implements this: compare intended KPIs to actual VFS state, signal
 *   correction when they diverge.
 *
 * - **Holroyd & Coles (2002) — Reward Prediction Error:** The ACC
 *   computes a reward prediction error (RPE) — the difference between
 *   expected and actual reward. The Verifier's per-KPI pass/fail is a
 *   discrete analog: each KPI is a predicted outcome, and the check
 *   result is the actual outcome.
 *
 * - **Norman & Shallice (1986) — Supervisory Attentional System (SAS):**
 *   The SAS intervenes when routine action monitoring detects an error.
 *   The CorrectionSignal is the SAS intervention: it overrides the default
 *   continuation with a corrective directive.
 *
 * **What this module captures:**
 * - Programmatic KPI verification against VFS state
 * - LLM-based fallback for KPIs without machine-checkable predicates
 * - CorrectionSignal production on failure
 * - Consecutive failure tracking for escalation
 * - VerifierMonitoring for upstream metacognitive oversight
 *
 * **What this module does NOT capture (known gaps):**
 * - No partial credit: KPIs are binary (met/not met)
 * - No adaptive threshold: correction is always triggered on any failure
 * - No historical KPI weighting: all KPIs are equally important
 *
 * **References:**
 * - Botvinick, M. M., Braver, T. S., Barch, D. M., Carter, C. S., & Cohen, J. D.
 *   (2001). Conflict monitoring and cognitive control. Psychological Review, 108(3), 624-652.
 * - Holroyd, C. B., & Coles, M. G. H. (2002). The neural basis of human error
 *   processing. Psychological Review, 109(4), 679-709.
 * - Norman, D. A., & Shallice, T. (1986). Attention to action. In R. J. Davidson,
 *   G. E. Schwartz, & D. Shapiro (Eds.), Consciousness and Self-Regulation (Vol. 4).
 *
 * @see docs/prds/048-cybernetic-verification-loop.md
 * @see docs/rfcs/006-anticipatory-monitoring.md — Part IV (Verification)
 */

import type {
  CognitiveModule,
  VerifierMonitoring,
  ControlDirective,
  StepResult,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
  CheckableKPI,
  VerificationResult,
  VerificationState,
  CorrectionSignal,
  ModuleWorkingMemory,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Verifier module. */
export interface VerifierConfig {
  /** Module ID override. Default: 'verifier'. */
  id?: string;
  /** PRD 045: type-driven context binding. */
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
  /** System prompt for the LLM fallback verification call. */
  systemPrompt?: string;
  /** Timeout for LLM verification calls. Default: 15000ms. */
  timeoutMs?: number;
}

/** Input to the Verifier: last action + workspace + KPIs. */
export interface VerifierInput {
  /** The last action taken by the Actor. */
  lastAction: { tool: string; input: unknown; result: unknown };
  /** Workspace snapshot for building VerificationState. */
  workspaceSnapshot: ReadonlyWorkspaceSnapshot;
  /** KPIs to verify against. */
  kpis: CheckableKPI[];
  /** Current subgoal description (for context in LLM fallback). */
  currentSubgoal: string;
}

/** Output: verification result + optional correction signal. */
export interface VerifierOutput {
  /** Full verification result with per-KPI status. */
  verification: VerificationResult;
  /** Correction signal produced when verification fails. */
  correctionSignal?: CorrectionSignal;
}

/** State: verification history + failure tracking. */
export interface VerifierState {
  /** History of verification results. */
  verificationHistory: VerificationResult[];
  /** Number of consecutive verification failures. */
  consecutiveFailures: number;
  /** Per-module working memory (optional). */
  workingMemory?: ModuleWorkingMemory;
}

/** Control directive for the Verifier (no special fields beyond base). */
export interface VerifierControl extends ControlDirective {
  // Extends ControlDirective — no special fields needed for Wave 1.
}

// ── LLM Prompt ────────────────────────────────────────────────────

const DEFAULT_VERIFY_SYSTEM_PROMPT =
  `You are a verification module for a coding agent. Given the last action taken and a list of KPIs, determine whether each KPI was satisfied.

Respond with a JSON object containing:
- results: array of { kpi: string, met: boolean, evidence: string }

Be precise. Only mark a KPI as met if there is clear evidence the action achieved it. When uncertain, mark as not met and explain what's missing.`;

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Verifier cognitive module.
 *
 * Two verification modes:
 * - **Programmatic:** KPIs with check() are run directly against VerificationState.
 * - **LLM fallback:** KPIs without check() are batched into one LLM call.
 *
 * When no KPIs have check() AND no provider is available, returns verified=true
 * (can't verify without tools).
 *
 * @param provider - Optional ProviderAdapter for LLM fallback verification.
 * @param config - Optional configuration (id, context binding, timeout).
 */
export function createVerifier(
  provider?: ProviderAdapter,
  config?: VerifierConfig,
): CognitiveModule<VerifierInput, VerifierOutput, VerifierState, VerifierMonitoring, VerifierControl> {
  const id = moduleId(config?.id ?? 'verifier');
  const systemPrompt = config?.systemPrompt ?? DEFAULT_VERIFY_SYSTEM_PROMPT;
  const timeoutMs = config?.timeoutMs ?? 15_000;

  return {
    id,
    contextBinding: config?.contextBinding ?? {
      types: ['operational'],
      budget: 2048,
      strategy: 'salience' as const,
    },

    async step(
      input: VerifierInput,
      state: VerifierState,
      _control: VerifierControl,
    ): Promise<StepResult<VerifierOutput, VerifierState, VerifierMonitoring>> {
      const { lastAction, workspaceSnapshot, kpis, currentSubgoal } = input;

      // ── Trivial case: no KPIs to verify ──────────────────────
      if (kpis.length === 0) {
        const verification: VerificationResult = {
          verified: true,
          kpiStatus: [],
        };

        return buildResult(id, verification, undefined, state);
      }

      // ── Build VerificationState from workspace snapshot ──────
      const vfsState = buildVerificationState(workspaceSnapshot, lastAction);

      // ── Partition KPIs: programmatic vs LLM ──────────────────
      const programmaticKPIs: CheckableKPI[] = [];
      const llmKPIs: CheckableKPI[] = [];

      for (const kpi of kpis) {
        if (kpi.check) {
          programmaticKPIs.push(kpi);
        } else {
          llmKPIs.push(kpi);
        }
      }

      // ── Run programmatic checks ──────────────────────────────
      const kpiStatus: Array<{ kpi: string; met: boolean; evidence: string }> = [];

      for (const kpi of programmaticKPIs) {
        const result = kpi.check!(vfsState);
        kpiStatus.push({
          kpi: kpi.description,
          met: result.met,
          evidence: result.evidence,
        });
      }

      // ── LLM fallback for unchecked KPIs ──────────────────────
      if (llmKPIs.length > 0 && provider) {
        const llmResults = await verifyWithLLM(
          provider,
          lastAction,
          llmKPIs,
          currentSubgoal,
          systemPrompt,
          timeoutMs,
        );
        kpiStatus.push(...llmResults);
      } else if (llmKPIs.length > 0 && !provider) {
        // No check() and no provider — can't verify, assume met
        for (const kpi of llmKPIs) {
          kpiStatus.push({
            kpi: kpi.description,
            met: true,
            evidence: 'No check() predicate and no LLM provider — assumed met',
          });
        }
      }

      // ── Build verification result ────────────────────────────
      const allMet = kpiStatus.every(s => s.met);
      const unmetKPIs = kpiStatus.filter(s => !s.met).map(s => s.kpi);

      let diagnosis: string | undefined;
      let correctionSignal: CorrectionSignal | undefined;

      if (!allMet) {
        diagnosis = buildDiagnosis(lastAction, kpiStatus);
        const failureCount = state.consecutiveFailures + 1;
        correctionSignal = {
          problem: diagnosis,
          suggestion: buildSuggestion(lastAction, unmetKPIs),
          unmetKPIs,
          failureCount,
        };
      }

      const verification: VerificationResult = {
        verified: allMet,
        kpiStatus,
        diagnosis,
        correction: correctionSignal,
      };

      return buildResult(id, verification, correctionSignal, state);
    },

    initialState(): VerifierState {
      return {
        verificationHistory: [],
        consecutiveFailures: 0,
      };
    },

    stateInvariant(state: VerifierState): boolean {
      return state.consecutiveFailures >= 0;
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Build a VerificationState from workspace snapshot + last action.
 *
 * Extracts file-like entries from the workspace to populate the VFS map.
 * Workspace entries with string content that look like file paths are treated
 * as file contents.
 */
function buildVerificationState(
  snapshot: ReadonlyWorkspaceSnapshot,
  lastAction: { tool: string; input: unknown; result: unknown },
): VerificationState {
  const files = new Map<string, string>();

  for (const entry of snapshot) {
    if (typeof entry.content === 'string') {
      // Convention: entries with source containing 'file:' prefix or entries
      // that look like file writes are treated as VFS entries.
      const sourceStr = String(entry.source);
      if (sourceStr.startsWith('file:')) {
        const path = sourceStr.slice(5);
        files.set(path, entry.content);
      }
    } else if (
      entry.content !== null &&
      typeof entry.content === 'object' &&
      'path' in (entry.content as Record<string, unknown>) &&
      'content' in (entry.content as Record<string, unknown>)
    ) {
      // Structured file entry: { path: string, content: string }
      const obj = entry.content as { path: string; content: string };
      if (typeof obj.path === 'string' && typeof obj.content === 'string') {
        files.set(obj.path, obj.content);
      }
    }
  }

  return {
    files,
    lastAction,
    actionHistory: [], // Populated by the orchestrator in a full cycle; minimal here.
  };
}

/**
 * Verify KPIs using LLM fallback — batch all unchecked KPIs into one call.
 */
async function verifyWithLLM(
  provider: ProviderAdapter,
  lastAction: { tool: string; input: unknown; result: unknown },
  kpis: CheckableKPI[],
  currentSubgoal: string,
  systemPrompt: string,
  timeoutMs: number,
): Promise<Array<{ kpi: string; met: boolean; evidence: string }>> {
  const kpiList = kpis.map(k => k.description).join('\n- ');
  const actionSummary = `Tool: ${lastAction.tool}, Input: ${JSON.stringify(lastAction.input)}, Result: ${JSON.stringify(lastAction.result)}`;

  const promptContent = `[VERIFICATION REQUEST]
Current subgoal: ${currentSubgoal}
Last action: ${actionSummary}

KPIs to verify:
- ${kpiList}

Determine whether each KPI was satisfied by the last action. Respond with JSON only.`;

  const adapterConfig: AdapterConfig = {
    pactTemplate: { mode: { type: 'oneshot' } },
    systemPrompt,
    timeoutMs,
  };

  const workspaceSnapshot: ReadonlyWorkspaceSnapshot = [
    {
      source: 'verifier' as ModuleId,
      content: promptContent,
      salience: 1.0,
      timestamp: Date.now(),
    },
  ];

  try {
    const result = await provider.invoke(workspaceSnapshot, adapterConfig);
    return parseLLMVerificationResponse(result.output, kpis);
  } catch {
    // On LLM failure, conservatively mark all KPIs as not met
    return kpis.map(k => ({
      kpi: k.description,
      met: false,
      evidence: 'LLM verification failed — conservatively marked as not met',
    }));
  }
}

/**
 * Parse the LLM's JSON response into per-KPI results.
 * Falls back to not-met on parse failure.
 */
function parseLLMVerificationResponse(
  output: string,
  kpis: CheckableKPI[],
): Array<{ kpi: string; met: boolean; evidence: string }> {
  try {
    const parsed = JSON.parse(output) as {
      results?: Array<{ kpi: string; met: boolean; evidence: string }>;
    };

    if (parsed.results && Array.isArray(parsed.results)) {
      // Match parsed results to KPIs by description
      return kpis.map(kpi => {
        const match = parsed.results!.find(r => r.kpi === kpi.description);
        if (match) {
          return { kpi: kpi.description, met: !!match.met, evidence: match.evidence ?? '' };
        }
        return { kpi: kpi.description, met: false, evidence: 'No LLM assessment returned for this KPI' };
      });
    }
  } catch {
    // Parse failure — fall through
  }

  return kpis.map(k => ({
    kpi: k.description,
    met: false,
    evidence: 'Failed to parse LLM verification response',
  }));
}

/**
 * Build a human-readable diagnosis from failed KPIs.
 */
function buildDiagnosis(
  lastAction: { tool: string; input: unknown; result: unknown },
  kpiStatus: Array<{ kpi: string; met: boolean; evidence: string }>,
): string {
  const failed = kpiStatus.filter(s => !s.met);
  const failedDescriptions = failed.map(f => `  - ${f.kpi}: ${f.evidence}`).join('\n');
  return `Action "${lastAction.tool}" did not satisfy ${failed.length} KPI(s):\n${failedDescriptions}`;
}

/**
 * Build a corrective suggestion from unmet KPIs.
 */
function buildSuggestion(
  lastAction: { tool: string; input: unknown; result: unknown },
  unmetKPIs: string[],
): string {
  if (unmetKPIs.length === 1) {
    return `Re-attempt "${lastAction.tool}" to satisfy: ${unmetKPIs[0]}`;
  }
  return `Re-attempt or adjust approach to satisfy ${unmetKPIs.length} unmet KPIs: ${unmetKPIs.join(', ')}`;
}

/**
 * Build the StepResult from verification outcome.
 */
function buildResult(
  id: ModuleId,
  verification: VerificationResult,
  correctionSignal: CorrectionSignal | undefined,
  state: VerifierState,
): StepResult<VerifierOutput, VerifierState, VerifierMonitoring> {
  const kpisChecked = verification.kpiStatus.length;
  const kpisPassing = verification.kpiStatus.filter(s => s.met).length;
  const newConsecutiveFailures = verification.verified
    ? 0
    : state.consecutiveFailures + 1;

  const newState: VerifierState = {
    verificationHistory: [...state.verificationHistory, verification],
    consecutiveFailures: newConsecutiveFailures,
    workingMemory: state.workingMemory,
  };

  const monitoring: VerifierMonitoring = {
    type: 'verifier',
    source: id,
    timestamp: Date.now(),
    verified: verification.verified,
    kpisChecked,
    kpisPassing,
    failureStreak: newConsecutiveFailures,
  };

  return {
    output: { verification, correctionSignal },
    state: newState,
    monitoring,
  };
}
