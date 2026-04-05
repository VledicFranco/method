/**
 * BuildOrchestrator tests — 8-phase loop, failure routing, autonomy levels.
 *
 * Uses mock CheckpointPort, mock ConversationPort, and overridden strategy executor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BuildOrchestrator } from '../orchestrator.js';
import type { StrategyExecutionResult } from '../orchestrator.js';
import type { CheckpointPort, PipelineCheckpoint, PipelineCheckpointSummary, Phase } from '../../../ports/checkpoint.js';
import type { ConversationPort, AgentMessage, GateDecision, GateType, HumanMessage, SkillRequest } from '../../../ports/conversation.js';
import type { ConversationMessage } from '../../../ports/checkpoint.js';
import type { BuildConfig } from '../config.js';
import { BuildConfigSchema } from '../config.js';

// ── Mock CheckpointPort ───────────────────────────────────────

class MockCheckpointPort implements CheckpointPort {
  saved: Array<{ sessionId: string; checkpoint: PipelineCheckpoint }> = [];
  stored: Map<string, PipelineCheckpoint> = new Map();

  async save(sessionId: string, checkpoint: PipelineCheckpoint): Promise<void> {
    this.saved.push({ sessionId, checkpoint });
    this.stored.set(sessionId, checkpoint);
  }

  async load(sessionId: string): Promise<PipelineCheckpoint | null> {
    return this.stored.get(sessionId) ?? null;
  }

  async list(): Promise<PipelineCheckpointSummary[]> {
    return Array.from(this.stored.entries()).map(([sessionId, cp]) => ({
      sessionId,
      phase: cp.phase,
      requirement: cp.featureSpec?.requirement ?? '',
      costAccumulator: { ...cp.costAccumulator },
      savedAt: cp.savedAt,
    }));
  }
}

// ── Mock ConversationPort ─────────────────────────────────────

class MockConversationPort implements ConversationPort {
  messages: Array<{ buildId: string; message: AgentMessage | string; type: 'agent' | 'system' }> = [];
  gateDecisions: Map<GateType, GateDecision> = new Map();
  humanMessages: HumanMessage[] = [];
  private gateCallCount = 0;

  async sendAgentMessage(buildId: string, message: AgentMessage): Promise<void> {
    this.messages.push({ buildId, message, type: 'agent' });
  }

  async sendSystemMessage(buildId: string, message: string): Promise<void> {
    this.messages.push({ buildId, message, type: 'system' });
  }

  async waitForHumanMessage(_buildId: string): Promise<HumanMessage> {
    return this.humanMessages.shift() ?? { content: 'ok' };
  }

  async waitForGateDecision(_buildId: string, gate: GateType): Promise<GateDecision> {
    this.gateCallCount++;
    return this.gateDecisions.get(gate) ?? { gate, decision: 'approve' };
  }

  async getHistory(_buildId: string): Promise<ConversationMessage[]> {
    return [];
  }

  async requestSkillInvocation(_buildId: string, _skill: SkillRequest): Promise<void> {
    // no-op
  }

  get totalGateCalls(): number {
    return this.gateCallCount;
  }
}

// ── Test Orchestrator (overridable strategy) ──────────────────

class TestOrchestrator extends BuildOrchestrator {
  strategyResults: Map<string, StrategyExecutionResult> = new Map();
  strategyCalls: Array<{ phase: Phase; strategyId: string; context?: Record<string, unknown> }> = [];

  protected override async executeStrategy(
    phase: Phase,
    strategyId: string,
    context?: Record<string, unknown>,
  ): Promise<StrategyExecutionResult> {
    this.strategyCalls.push({ phase, strategyId, context });

    const key = `${phase}:${strategyId}`;
    const result = this.strategyResults.get(key);
    if (result) return result;

    // Default: success
    return {
      success: true,
      output: `Strategy ${strategyId} completed for phase ${phase}`,
      cost: { tokens: 100, usd: 0.01 },
      executionId: `exec-${strategyId}-${Date.now()}`,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────

function defaultConfig(): BuildConfig {
  return BuildConfigSchema.parse({});
}

function createOrchestrator(opts?: {
  config?: Partial<BuildConfig>;
  gateDecisions?: Map<GateType, GateDecision>;
}): {
  orchestrator: TestOrchestrator;
  checkpoint: MockCheckpointPort;
  conversation: MockConversationPort;
} {
  const checkpoint = new MockCheckpointPort();
  const conversation = new MockConversationPort();
  const config = BuildConfigSchema.parse(opts?.config ?? {});

  if (opts?.gateDecisions) {
    for (const [gate, decision] of opts.gateDecisions) {
      conversation.gateDecisions.set(gate, decision);
    }
  }

  const orchestrator = new TestOrchestrator(checkpoint, conversation, config, undefined, 'test-build-001');
  return { orchestrator, checkpoint, conversation };
}

// ── Tests ─────────────────────────────────────────────────────

describe('BuildOrchestrator', () => {
  describe('8-phase loop', () => {
    it('completes all 8 phases with discuss-all autonomy', async () => {
      const { orchestrator, checkpoint, conversation } = createOrchestrator();

      // Set gate decisions — discuss-all requires all gates
      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      const report = await orchestrator.start('Add user authentication', 'discuss-all');

      // Verify all phases executed
      expect(report.requirement).toBe('Add user authentication');
      expect(report.phases.length).toBeGreaterThanOrEqual(7); // measure adds itself after report creation
      expect(report.verdict).toBe('fully_validated');

      // Verify checkpoints were saved
      expect(checkpoint.saved.length).toBeGreaterThanOrEqual(7);

      // Verify conversation received system messages for each phase
      const systemMessages = conversation.messages.filter(m => m.type === 'system');
      expect(systemMessages.length).toBeGreaterThanOrEqual(8); // At least one per phase
    });

    it('produces an EvidenceReport with delivery metrics', async () => {
      const { orchestrator, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      const report = await orchestrator.start('Build search', 'discuss-all');

      expect(report.delivery).toBeDefined();
      expect(report.delivery.wallClockMs).toBeGreaterThanOrEqual(0);
      expect(report.delivery.totalCost).toBeDefined();
      expect(report.delivery.totalCost.tokens).toBeGreaterThanOrEqual(0);
      expect(report.delivery.humanInterventions).toBeGreaterThanOrEqual(0);
      expect(report.delivery.failureRecoveries).toBeDefined();
    });

    it('records strategy execution calls', async () => {
      const { orchestrator, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      await orchestrator.start('Test feature', 'discuss-all');

      const phases = orchestrator.strategyCalls.map(c => c.phase);
      expect(phases).toContain('explore');
      expect(phases).toContain('design');
      expect(phases).toContain('plan');
      expect(phases).toContain('implement');
      expect(phases).toContain('review');
    });
  });

  describe('failure routing', () => {
    it('retries implementation on strategy failure', async () => {
      const { orchestrator, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      // First implement call fails, retry succeeds
      let implCallCount = 0;
      orchestrator.strategyResults.set('implement:implement-commissions', {
        success: false,
        output: 'Compilation error',
        cost: { tokens: 500, usd: 0.05 },
        executionId: 'exec-fail-1',
        error: 'Type error in module X',
      });
      orchestrator.strategyResults.set('implement:implement-commissions-retry', {
        success: true,
        output: 'Fixed and compiled',
        cost: { tokens: 300, usd: 0.03 },
        executionId: 'exec-retry-1',
      });

      const report = await orchestrator.start('Feature with retry', 'discuss-all');

      // Verify retry happened
      const implCalls = orchestrator.strategyCalls.filter(c => c.phase === 'implement');
      expect(implCalls.length).toBeGreaterThanOrEqual(2); // original + retry

      // Verify retry had context
      const retryCalls = implCalls.filter(c => c.strategyId === 'implement-commissions-retry');
      expect(retryCalls.length).toBeGreaterThanOrEqual(1);
      expect(retryCalls[0].context).toBeDefined();
      expect(retryCalls[0].context!.previousError).toBe('Type error in module X');

      // Verify failure recovery was tracked
      expect(report.delivery.failureRecoveries.attempted).toBeGreaterThanOrEqual(1);
      expect(report.delivery.failureRecoveries.succeeded).toBeGreaterThanOrEqual(1);
    });

    it('escalates when implementation fails after retry', async () => {
      const { orchestrator, conversation } = createOrchestrator({
        config: { reviewLoopLimit: 1 },
      });

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });
      conversation.gateDecisions.set('escalation', { gate: 'escalation', decision: 'approve' });

      // Both implement attempts fail
      orchestrator.strategyResults.set('implement:implement-commissions', {
        success: false,
        output: 'Fatal error',
        cost: { tokens: 500, usd: 0.05 },
        executionId: 'exec-fail-1',
        error: 'Module not found',
      });
      orchestrator.strategyResults.set('implement:implement-commissions-retry', {
        success: false,
        output: 'Still failing',
        cost: { tokens: 300, usd: 0.03 },
        executionId: 'exec-fail-2',
        error: 'Module not found again',
      });

      const report = await orchestrator.start('Failing feature', 'discuss-all');

      // Should have escalation
      const systemMsgs = conversation.messages
        .filter(m => m.type === 'system')
        .map(m => m.message as string);
      expect(systemMsgs.some(m => typeof m === 'string' && m.includes('Escalating'))).toBe(true);

      // Report should have refinements about failures
      expect(report.delivery.failureRecoveries.attempted).toBeGreaterThanOrEqual(1);
    });
  });

  describe('autonomy levels', () => {
    it('discuss-all waits for gate decisions at every gate', async () => {
      const { orchestrator, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      const report = await orchestrator.start('Gated feature', 'discuss-all');

      // Should have called waitForGateDecision for specify, design, plan, review
      expect(conversation.totalGateCalls).toBeGreaterThanOrEqual(4);
      expect(report.delivery.humanInterventions).toBeGreaterThanOrEqual(4);
    });

    it('full-auto skips all gates', async () => {
      const { orchestrator, conversation } = createOrchestrator();

      const report = await orchestrator.start('Auto feature', 'full-auto');

      // Should NOT have called waitForGateDecision
      expect(conversation.totalGateCalls).toBe(0);
      expect(report.delivery.humanInterventions).toBe(0);
    });

    it('auto-routine skips gates when confidence is high', async () => {
      const { orchestrator, conversation } = createOrchestrator({
        config: { autoRoutineConfidenceThreshold: 0.5 },
      });

      // All strategies succeed, so confidence should be above 0.5 after explore
      const report = await orchestrator.start('Routine feature', 'auto-routine');

      // The first gate (specify) may be called since there is only 1 phase result at that point
      // (confidence = 1/1 = 1.0 >= 0.5, so it should be skipped)
      // Subsequent gates should also be skipped since all phases succeed
      expect(conversation.totalGateCalls).toBeLessThan(4);
    });

    it('auto-routine falls back to human when confidence is low', async () => {
      const { orchestrator, conversation } = createOrchestrator({
        config: { autoRoutineConfidenceThreshold: 1.1 }, // Impossible to reach — forces all gates to human
      });

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      const report = await orchestrator.start('Uncertain feature', 'auto-routine');

      // Confidence can never reach 1.1, so every gate requires human approval
      expect(conversation.totalGateCalls).toBeGreaterThanOrEqual(4);
    });
  });

  describe('checkpoint persistence', () => {
    it('saves checkpoint after every phase transition', async () => {
      const { orchestrator, checkpoint, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      await orchestrator.start('Checkpoint feature', 'discuss-all');

      // Should have at least 8 checkpoint saves (one per phase transition)
      expect(checkpoint.saved.length).toBeGreaterThanOrEqual(7);

      // Verify phase progression in checkpoints
      const phases = checkpoint.saved.map(s => s.checkpoint.phase);
      expect(phases).toContain('specify');
      expect(phases).toContain('design');
      expect(phases).toContain('plan');
      expect(phases).toContain('implement');
      expect(phases).toContain('review');
      expect(phases).toContain('validate');
      expect(phases).toContain('measure');
      expect(phases).toContain('completed');
    });

    it('checkpoint includes session id and cost accumulator', async () => {
      const { orchestrator, checkpoint, conversation } = createOrchestrator();

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });

      await orchestrator.start('Cost tracking', 'discuss-all');

      const lastCheckpoint = checkpoint.saved[checkpoint.saved.length - 1];
      expect(lastCheckpoint.sessionId).toBe('test-build-001');
      expect(lastCheckpoint.checkpoint.costAccumulator).toBeDefined();
      expect(lastCheckpoint.checkpoint.savedAt).toBeDefined();
    });
  });

  describe('refinements', () => {
    it('generates refinements when phases fail', async () => {
      const { orchestrator, conversation } = createOrchestrator({
        config: { reviewLoopLimit: 1 },
      });

      conversation.gateDecisions.set('specify', { gate: 'specify', decision: 'approve' });
      conversation.gateDecisions.set('design', { gate: 'design', decision: 'approve' });
      conversation.gateDecisions.set('plan', { gate: 'plan', decision: 'approve' });
      conversation.gateDecisions.set('review', { gate: 'review', decision: 'approve' });
      conversation.gateDecisions.set('escalation', { gate: 'escalation', decision: 'approve' });

      // Make implementation fail
      orchestrator.strategyResults.set('implement:implement-commissions', {
        success: false,
        output: 'Build error',
        cost: { tokens: 100, usd: 0.01 },
        executionId: 'exec-fail',
        error: 'Compilation failed',
      });
      orchestrator.strategyResults.set('implement:implement-commissions-retry', {
        success: false,
        output: 'Still failing',
        cost: { tokens: 100, usd: 0.01 },
        executionId: 'exec-fail-2',
        error: 'Still broken',
      });

      const report = await orchestrator.start('Failing build', 'discuss-all');

      // Should have refinements about the failure
      expect(report.refinements.length).toBeGreaterThan(0);
      const failureRefinement = report.refinements.find(r => r.target === 'orchestrator');
      expect(failureRefinement).toBeDefined();
      expect(failureRefinement!.observation).toContain('failed');
    });
  });
});
