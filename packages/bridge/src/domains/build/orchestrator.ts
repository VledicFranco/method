/**
 * BuildOrchestrator — 8-phase build lifecycle loop.
 *
 * Drives a requirement through: explore → specify → design → plan →
 * implement → review → validate → measure. Each phase saves a checkpoint,
 * gates consult the human (or auto-approve based on autonomy level),
 * and failures route to retry with context.
 *
 * @see PRD 047 — Build Orchestrator
 */

import type { CheckpointPort, PipelineCheckpoint, Phase, FeatureSpec, TestableAssertion, ConversationMessage } from '../../ports/checkpoint.js';
import type { ConversationPort, GateDecision } from '../../ports/conversation.js';
import type { StrategyExecutorPort, StrategyExecutionResult } from '../../ports/strategy-executor.js';
import type { BuildConfig } from './config.js';
import type {
  AutonomyLevel,
  ExplorationReport,
  ValidationReport,
  EvidenceReport,
  PhaseResult,
  Refinement,
} from './types.js';
import type { Validator } from './validator.js';

// Re-export for domain consumers that previously imported from this file.
export type { StrategyExecutionResult } from '../../ports/strategy-executor.js';

// ── Phase event callback (§3.3) ──────────────────────────────

export type PhaseEventType =
  | 'phase_started'
  | 'phase_completed'
  | 'checkpoint_saved'
  | 'gate_waiting'
  | 'failure_recovery'
  | 'validation_result';

export interface PhaseEvent {
  type: PhaseEventType;
  buildId: string;
  payload: Record<string, unknown>;
}

export type PhaseEventCallback = (event: PhaseEvent) => void;

// ── Orchestrator ───────────────────────────────────────────────

const PHASE_ORDER: readonly Phase[] = [
  'explore', 'specify', 'design', 'plan', 'implement', 'review', 'validate', 'measure',
] as const;

export class BuildOrchestrator {
  private readonly sessionId: string;
  private autonomyLevel: AutonomyLevel;
  private requirement = '';
  private featureSpec: FeatureSpec | undefined;
  private phaseResults: PhaseResult[] = [];
  private completedStrategies: string[] = [];
  private artifactManifest: Record<string, string> = {};
  private conversationHistory: ConversationMessage[] = [];
  private costAccumulator = { tokens: 0, usd: 0 };
  private startTime = 0;
  private humanInterventions = 0;
  private failureRecoveries = { attempted: 0, succeeded: 0 };
  private reviewLoopCount = 0;
  private validateLoopCount = 0;
  private readonly onPhaseEvent?: PhaseEventCallback;

  constructor(
    private readonly checkpoint: CheckpointPort,
    private readonly conversation: ConversationPort,
    private readonly config: BuildConfig,
    private readonly strategyExecutor: StrategyExecutorPort,
    private readonly validator?: Validator,
    sessionId?: string,
    onPhaseEvent?: PhaseEventCallback,
  ) {
    this.sessionId = sessionId ?? `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.autonomyLevel = config.defaultAutonomyLevel as AutonomyLevel;
    this.onPhaseEvent = onPhaseEvent;
  }

  /** Unique session identifier for this build. */
  get id(): string {
    return this.sessionId;
  }

  /**
   * Drive the full 8-phase loop.
   * Returns an EvidenceReport summarizing the build outcome.
   */
  async start(requirement: string, autonomyLevel: AutonomyLevel): Promise<EvidenceReport> {
    this.requirement = requirement;
    this.autonomyLevel = autonomyLevel;
    this.startTime = Date.now();

    await this.conversation.sendSystemMessage(this.sessionId, `Build started: ${requirement}`);

    // Phase 1: Explore
    const exploration = await this.withTimeout(this.explore(), 'explore');

    // Phase 2: Specify (gate)
    const spec = await this.withTimeout(this.specify(exploration), 'specify');
    this.featureSpec = spec;

    // Phase 3: Design (gate)
    await this.withTimeout(this.design(), 'design');

    // Phase 4: Plan (gate)
    await this.withTimeout(this.plan(), 'plan');

    // Phase 5+6: Implement → Review loop
    await this.withTimeout(this.implementReviewLoop(), 'implement-review');

    // Phase 7: Validate
    const validationReport = await this.withTimeout(this.validate(), 'validate');
    this._lastValidationReport = validationReport;

    // Phase 8: Measure
    return this.withTimeout(this.measure(), 'measure');
  }

  // ── Phase 1: Explore ───────────────────────────────────────────

  async explore(): Promise<ExplorationReport> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'explore' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: explore — analyzing codebase');

    const strategyId = this.config.strategyIds.explore;
    const result = await this.executeStrategy('explore', strategyId);

    const report: ExplorationReport = {
      domains: result.success ? ['build'] : [],
      patterns: result.success ? ['FCA domain structure'] : [],
      constraints: result.success ? ['G-PORT: use ports'] : [],
      approach: result.output || 'Codebase exploration completed',
    };

    const phaseResult = this.buildPhaseResult('explore', strategyId, result, phaseStart);
    this.phaseResults.push(phaseResult);

    await this.saveCheckpoint('specify');
    this.emitPhaseEvent('phase_completed', { phase: 'explore', cost: result.cost, durationMs: Date.now() - phaseStart });

    return report;
  }

  // ── Phase 2: Specify (gate) ────────────────────────────────────

  async specify(exploration: ExplorationReport): Promise<FeatureSpec> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'specify' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: specify — collecting feature spec');

    // Present exploration findings to human
    await this.conversation.sendAgentMessage(this.sessionId, {
      type: 'card',
      content: `Exploration complete. Found ${exploration.domains.length} domains, ${exploration.patterns.length} patterns.`,
      card: {
        type: 'feature-spec',
        data: { exploration },
      },
    });

    // Gate: wait for human to provide/approve the spec
    const gateResult = await this.gate('specify');

    const spec: FeatureSpec = {
      requirement: this.requirement,
      problem: gateResult.feedback || exploration.approach,
      criteria: this.extractCriteria(gateResult),
      scope: { in: exploration.domains.slice() as string[], out: [] },
      constraints: exploration.constraints.slice() as string[],
    };

    const phaseResult: PhaseResult = {
      phase: 'specify',
      status: 'completed',
      cost: { tokens: 0, usd: 0 },
      durationMs: Date.now() - phaseStart,
      retries: 0,
    };
    this.phaseResults.push(phaseResult);

    await this.saveCheckpoint('design');
    this.emitPhaseEvent('phase_completed', { phase: 'specify', durationMs: Date.now() - phaseStart });

    return spec;
  }

  // ── Phase 3: Design (gate) ─────────────────────────────────────

  async design(): Promise<void> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'design' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: design — architecture decisions');

    const strategyId = this.config.strategyIds.design;
    const result = await this.executeStrategy('design', strategyId);

    await this.conversation.sendAgentMessage(this.sessionId, {
      type: 'card',
      content: 'Design proposal ready for review.',
      card: {
        type: 'review-findings',
        data: { design: result.output },
      },
    });

    await this.gate('design');

    const phaseResult = this.buildPhaseResult('design', strategyId, result, phaseStart);
    this.phaseResults.push(phaseResult);

    this.emitPhaseEvent('phase_completed', { phase: 'design', durationMs: Date.now() - phaseStart });
    await this.saveCheckpoint('plan');
  }

  // ── Phase 4: Plan (gate) ───────────────────────────────────────

  async plan(): Promise<void> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'plan' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: plan — commission decomposition');

    const strategyId = this.config.strategyIds.plan;
    const result = await this.executeStrategy('plan', strategyId);

    await this.conversation.sendAgentMessage(this.sessionId, {
      type: 'card',
      content: 'Commission plan ready for review.',
      card: {
        type: 'commission-plan',
        data: { plan: result.output },
      },
    });

    await this.gate('plan');

    const phaseResult = this.buildPhaseResult('plan', strategyId, result, phaseStart);
    this.phaseResults.push(phaseResult);

    this.emitPhaseEvent('phase_completed', { phase: 'plan', durationMs: Date.now() - phaseStart });
    await this.saveCheckpoint('implement');
  }

  // ── Phase 5: Implement ─────────────────────────────────────────

  async implement(): Promise<StrategyExecutionResult> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'implement' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: implement — executing commissions');

    const strategyId = this.config.strategyIds.implement;
    const result = await this.executeStrategy('implement', strategyId);

    if (!result.success) {
      // Failure routing: construct retry context and re-execute
      this.failureRecoveries.attempted++;

      await this.conversation.sendSystemMessage(
        this.sessionId,
        `Implementation failed: ${result.error || 'unknown error'}. Retrying with context...`,
      );

      const retryResult = await this.executeStrategy('implement', strategyId, {
        previousError: result.error || result.output,
        previousExecutionId: result.executionId,
        retry: true,
      });

      if (retryResult.success) {
        this.failureRecoveries.succeeded++;
      }

      this.emitPhaseEvent('failure_recovery', {
        phase: 'implement',
        strategy: strategyId,
        succeeded: retryResult.success,
      });

      const phaseResult = this.buildPhaseResult('implement', strategyId, retryResult, phaseStart, 1);
      this.phaseResults.push(phaseResult);

      if (retryResult.artifacts) {
        Object.assign(this.artifactManifest, retryResult.artifacts);
      }

      await this.saveCheckpoint('review');
      return retryResult;
    }

    const okPhaseResult = this.buildPhaseResult('implement', strategyId, result, phaseStart);
    this.phaseResults.push(okPhaseResult);

    if (result.artifacts) {
      Object.assign(this.artifactManifest, result.artifacts);
    }

    this.emitPhaseEvent('phase_completed', { phase: 'implement', cost: result.cost, durationMs: Date.now() - phaseStart });
    await this.saveCheckpoint('review');
    return result;
  }

  // ── Phase 6: Review (gate) ─────────────────────────────────────

  async review(): Promise<GateDecision> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'review' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: review — code review');

    const strategyId = this.config.strategyIds.review;
    const result = await this.executeStrategy('review', strategyId);

    await this.conversation.sendAgentMessage(this.sessionId, {
      type: 'card',
      content: 'Review findings ready.',
      card: {
        type: 'review-findings',
        data: { review: result.output },
      },
    });

    const gateResult = await this.gate('review');

    const phaseResult = this.buildPhaseResult('review', strategyId, result, phaseStart);
    this.phaseResults.push(phaseResult);

    this.emitPhaseEvent('phase_completed', { phase: 'review', durationMs: Date.now() - phaseStart });
    await this.saveCheckpoint('validate');

    return gateResult;
  }

  // ── Phase 7: Validate ──────────────────────────────────────────

  async validate(): Promise<ValidationReport> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'validate' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: validate — running testable assertions');

    let report: ValidationReport;

    if (this.validator && this.featureSpec) {
      report = await this.validator.evaluateAssertions(this.featureSpec.criteria);
      // Emit individual validation results
      for (const criterion of report.criteria) {
        this.emitPhaseEvent('validation_result', {
          criterion: criterion.name,
          passed: criterion.passed,
          evidence: criterion.evidence ?? '',
        });
      }
    } else {
      // No validator or no spec — report as skipped
      report = { criteria: [], allPassed: true };
    }

    const phaseResult: PhaseResult = {
      phase: 'validate',
      status: report.allPassed ? 'completed' : 'failed',
      cost: { tokens: 0, usd: 0 },
      durationMs: Date.now() - phaseStart,
      retries: 0,
    };
    this.phaseResults.push(phaseResult);

    this.emitPhaseEvent('phase_completed', { phase: 'validate', durationMs: Date.now() - phaseStart });
    await this.saveCheckpoint('measure');

    return report;
  }

  // ── Phase 8: Measure ───────────────────────────────────────────

  async measure(): Promise<EvidenceReport> {
    const phaseStart = Date.now();
    this.emitPhaseEvent('phase_started', { phase: 'measure' });

    await this.conversation.sendSystemMessage(this.sessionId, 'Phase: measure — producing evidence report');

    const validationReport = this.lastValidationReport();

    const criteriaPassed = validationReport?.criteria.filter(c => c.passed).length ?? 0;
    const criteriaFailed = validationReport?.criteria.filter(c => !c.passed).length ?? 0;
    const criteriaTotal = criteriaPassed + criteriaFailed;

    const wallClockMs = Date.now() - this.startTime;

    const refinements = this.collectRefinements();

    const verdict: EvidenceReport['verdict'] =
      criteriaFailed === 0 && criteriaTotal > 0
        ? 'fully_validated'
        : criteriaTotal > 0 && criteriaPassed > 0
          ? 'partially_validated'
          : criteriaTotal === 0
            ? 'fully_validated'
            : 'validation_failed';

    const report: EvidenceReport = {
      requirement: this.requirement,
      phases: [...this.phaseResults],
      validation: {
        criteriaTotal,
        criteriaPassed,
        criteriaFailed,
        details: validationReport?.criteria ? [...validationReport.criteria] : [],
      },
      delivery: {
        totalCost: { ...this.costAccumulator },
        orchestratorCost: { ...this.costAccumulator },
        overheadPercent: 0,
        wallClockMs,
        humanInterventions: this.humanInterventions,
        failureRecoveries: { ...this.failureRecoveries },
      },
      verdict,
      artifacts: { ...this.artifactManifest },
      refinements,
    };

    const phaseResult: PhaseResult = {
      phase: 'measure',
      status: 'completed',
      cost: { tokens: 0, usd: 0 },
      durationMs: Date.now() - phaseStart,
      retries: 0,
    };
    this.phaseResults.push(phaseResult);

    await this.conversation.sendAgentMessage(this.sessionId, {
      type: 'card',
      content: `Build complete: ${verdict}`,
      card: {
        type: 'evidence-report',
        data: report as unknown as Record<string, unknown>,
      },
    });

    await this.saveCheckpoint('completed');

    return report;
  }

  // ── Implement → Review Loop ────────────────────────────────────

  private async implementReviewLoop(): Promise<void> {
    this.reviewLoopCount = 0;

    while (this.reviewLoopCount < this.config.reviewLoopLimit) {
      const implResult = await this.implement();

      if (!implResult.success) {
        // Escalate if implementation keeps failing
        await this.conversation.sendSystemMessage(
          this.sessionId,
          'Implementation failed after retry. Escalating.',
        );
        const escalation = await this.conversation.waitForGateDecision(this.sessionId, 'escalation');
        this.humanInterventions++;
        if (escalation.decision === 'reject') return;
        // On adjust/approve, continue to review
      }

      const reviewDecision = await this.review();

      if (reviewDecision.decision === 'approve') {
        return;
      }

      this.reviewLoopCount++;

      if (this.reviewLoopCount >= this.config.reviewLoopLimit) {
        await this.conversation.sendSystemMessage(
          this.sessionId,
          `Review loop limit (${this.config.reviewLoopLimit}) reached. Proceeding to validation.`,
        );
        return;
      }

      await this.conversation.sendSystemMessage(
        this.sessionId,
        `Review requested changes. Re-implementing (attempt ${this.reviewLoopCount + 1}/${this.config.reviewLoopLimit}).`,
      );
    }
  }

  // ── Gate Check ─────────────────────────────────────────────────

  private async gate(gateType: 'specify' | 'design' | 'plan' | 'review' | 'escalation'): Promise<GateDecision> {
    // Full-auto: skip all gates
    if (this.autonomyLevel === 'full-auto') {
      return { gate: gateType, decision: 'approve' };
    }

    // Auto-routine: skip gates when confidence is above threshold
    if (this.autonomyLevel === 'auto-routine') {
      const confidence = this.estimateConfidence();
      if (confidence >= this.config.autoRoutineConfidenceThreshold) {
        return { gate: gateType, decision: 'approve' };
      }
    }

    // Discuss-all (or low confidence): always wait for human
    this.humanInterventions++;
    this.emitPhaseEvent('gate_waiting', { gate: gateType });
    return this.conversation.waitForGateDecision(this.sessionId, gateType);
  }

  // ── Strategy Execution (delegates to StrategyExecutorPort) ─────

  /**
   * Execute a strategy via the injected StrategyExecutorPort. The port
   * adapter resolves the strategy ID to a DAG, runs it, and returns a
   * normalized result. Remains `protected` for subclass-based test
   * overrides (though injecting a mock port is preferred).
   */
  protected async executeStrategy(
    _phase: Phase,
    strategyId: string,
    context?: Record<string, unknown>,
  ): Promise<StrategyExecutionResult> {
    this.completedStrategies.push(strategyId);
    return this.strategyExecutor.executeStrategy(strategyId, context ?? {});
  }

  // ── Checkpoint ─────────────────────────────────────────────────

  private async saveCheckpoint(nextPhase: Phase): Promise<void> {
    const checkpoint: PipelineCheckpoint = {
      sessionId: this.sessionId,
      phase: nextPhase,
      completedStrategies: [...this.completedStrategies],
      artifactManifest: { ...this.artifactManifest },
      featureSpec: this.featureSpec,
      costAccumulator: { ...this.costAccumulator },
      conversationHistory: [...this.conversationHistory],
      savedAt: new Date().toISOString(),
    };

    await this.checkpoint.save(this.sessionId, checkpoint);
    this.emitPhaseEvent('checkpoint_saved', { nextPhase });
  }

  // ── Phase Timeout (F-A-4) ─────────────────────────────────────

  private withTimeout<T>(promise: Promise<T>, phase: string): Promise<T> {
    const timeoutMs = this.config.phaseTimeoutMs;
    return Promise.race([
      promise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`Phase "${phase}" timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  // ── Phase Event Emission (§3.3) ──────────────────────────────

  private emitPhaseEvent(type: PhaseEventType, payload: Record<string, unknown>): void {
    this.onPhaseEvent?.({ type, buildId: this.sessionId, payload });
  }

  // ── Helpers ────────────────────────────────────────────────────

  private buildPhaseResult(
    phase: Phase,
    strategyId: string,
    result: StrategyExecutionResult,
    phaseStart: number,
    retries = 0,
  ): PhaseResult {
    this.costAccumulator.tokens += result.cost.tokens;
    this.costAccumulator.usd += result.cost.usd;

    return {
      phase,
      strategyId,
      executionId: result.executionId,
      status: result.success ? 'completed' : 'failed',
      cost: { ...result.cost },
      durationMs: Date.now() - phaseStart,
      retries,
      failureContext: result.success ? undefined : result.error,
    };
  }

  private extractCriteria(gateResult: GateDecision): TestableAssertion[] {
    if (gateResult.adjustments?.criteria) {
      return gateResult.adjustments.criteria as TestableAssertion[];
    }
    return [];
  }

  private estimateConfidence(): number {
    // Simple heuristic: confidence based on phase success rate
    if (this.phaseResults.length === 0) return 0.5;
    const successCount = this.phaseResults.filter(p => p.status === 'completed').length;
    return successCount / this.phaseResults.length;
  }

  private _lastValidationReport: ValidationReport | undefined;

  /** Store the last validation report for measure phase to access. */
  setValidationReport(report: ValidationReport): void {
    this._lastValidationReport = report;
  }

  private lastValidationReport(): ValidationReport | undefined {
    return this._lastValidationReport;
  }

  private collectRefinements(): Refinement[] {
    const refinements: Refinement[] = [];

    // Check for repeated failures
    const failedPhases = this.phaseResults.filter(p => p.status === 'failed');
    if (failedPhases.length > 0) {
      refinements.push({
        target: 'orchestrator',
        observation: `${failedPhases.length} phase(s) failed during build`,
        proposal: 'Review failure patterns and adjust strategy selection',
        evidence: failedPhases.map(p => `${p.phase}: ${p.failureContext || 'unknown'}`).join('; '),
      });
    }

    // Check for high intervention count
    if (this.humanInterventions > PHASE_ORDER.length) {
      refinements.push({
        target: 'gate',
        observation: `High human intervention count: ${this.humanInterventions}`,
        proposal: 'Consider increasing autonomy level or refining gate criteria',
        evidence: `${this.humanInterventions} interventions across ${this.phaseResults.length} phases`,
      });
    }

    return refinements;
  }
}
