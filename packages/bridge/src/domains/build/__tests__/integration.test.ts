// SPDX-License-Identifier: Apache-2.0
/**
 * Build Orchestrator — integration test.
 *
 * Verifies the full domain wires together: orchestrator + conversation
 * + checkpoint + validator executing all 8 phases with mock strategy results.
 *
 * @see PRD 047 — Build Orchestrator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BuildOrchestrator } from '../orchestrator.js';
import type { CheckpointPort, PipelineCheckpoint, PipelineCheckpointSummary } from '../../../ports/checkpoint.js';
import type { ConversationPort } from '../../../ports/conversation.js';
import type { AgentMessage, HumanMessage, GateDecision, GateType, SkillRequest } from '../../../ports/conversation.js';
import type { ConversationMessage } from '../../../ports/checkpoint.js';
import type { StrategyExecutorPort, StrategyExecutionResult } from '../../../ports/strategy-executor.js';
import { BuildConfigSchema } from '../config.js';

// ── Mock StrategyExecutorPort ──

function createMockStrategyExecutor(): StrategyExecutorPort {
  return {
    async executeStrategy(strategyId: string): Promise<StrategyExecutionResult> {
      return {
        success: true,
        output: `Strategy ${strategyId} completed (mock)`,
        cost: { tokens: 100, usd: 0.01 },
        executionId: `exec-${strategyId}-${Date.now()}`,
      };
    },
  };
}
// AutonomyLevel used as string literals in test calls

// ── Mock CheckpointPort ──

function createMockCheckpoint(): CheckpointPort & { saved: PipelineCheckpoint[] } {
  const saved: PipelineCheckpoint[] = [];
  return {
    saved,
    async save(_sessionId: string, checkpoint: PipelineCheckpoint) {
      saved.push(checkpoint);
    },
    async load(_sessionId: string) {
      return saved.length > 0 ? saved[saved.length - 1] : null;
    },
    async list(): Promise<PipelineCheckpointSummary[]> {
      return saved.map((c) => ({
        sessionId: c.sessionId,
        phase: c.phase,
        requirement: c.featureSpec?.requirement ?? '',
        costAccumulator: c.costAccumulator,
        savedAt: c.savedAt,
      }));
    },
  };
}

// ── Mock ConversationPort ──

function createMockConversation(): ConversationPort & { messages: ConversationMessage[]; gateDecisions: GateDecision[] } {
  const messages: ConversationMessage[] = [];
  const gateDecisions: GateDecision[] = [];

  return {
    messages,
    gateDecisions,
    async sendAgentMessage(_buildId: string, message: AgentMessage) {
      messages.push({
        id: `msg-${messages.length}`,
        sender: 'agent',
        content: message.content,
        timestamp: new Date().toISOString(),
      });
    },
    async sendSystemMessage(_buildId: string, content: string) {
      messages.push({
        id: `msg-${messages.length}`,
        sender: 'system',
        content,
        timestamp: new Date().toISOString(),
      });
    },
    async waitForHumanMessage(_buildId: string): Promise<HumanMessage> {
      return { content: 'Looks good, proceed.' };
    },
    async waitForGateDecision(_buildId: string, gate: GateType): Promise<GateDecision> {
      const decision: GateDecision = { gate, decision: 'approve' };
      gateDecisions.push(decision);
      return decision;
    },
    async getHistory(_buildId: string): Promise<ConversationMessage[]> {
      return [...messages];
    },
    async requestSkillInvocation(_buildId: string, _skill: SkillRequest) {
      // no-op in tests
    },
    receiveHumanMessage(_buildId: string, _message: HumanMessage): void {
      // no-op in tests
    },
    receiveGateDecision(_buildId: string, _decision: GateDecision): void {
      // no-op in tests
    },
  };
}

// ── Tests ──

describe('Build Orchestrator Integration', () => {
  let checkpoint: ReturnType<typeof createMockCheckpoint>;
  let conversation: ReturnType<typeof createMockConversation>;
  let config: ReturnType<typeof BuildConfigSchema.parse>;

  beforeEach(() => {
    checkpoint = createMockCheckpoint();
    conversation = createMockConversation();
    config = BuildConfigSchema.parse({
      maxOrchestratorTokens: 100_000,
      maxOrchestratorCostUsd: 2.0,
      maxDurationMs: 60_000,
      defaultAutonomyLevel: 'full-auto',
    });
  });

  it('instantiates with ports and config', () => {
    const orchestrator = new BuildOrchestrator(checkpoint, conversation, config, createMockStrategyExecutor());
    expect(orchestrator).toBeDefined();
  });

  it('checkpoint saves accumulate through phases', async () => {
    const orchestrator = new BuildOrchestrator(checkpoint, conversation, config, createMockStrategyExecutor());
    // Start a build — in full-auto mode, gates are auto-approved
    const report = await orchestrator.start('Add a health endpoint', 'full-auto');

    expect(report).toBeDefined();
    expect(report.requirement).toBe('Add a health endpoint');
    // Checkpoints saved for each phase transition
    expect(checkpoint.saved.length).toBeGreaterThanOrEqual(1);
  });

  it('conversation receives system messages during execution', async () => {
    const orchestrator = new BuildOrchestrator(checkpoint, conversation, config, createMockStrategyExecutor());
    await orchestrator.start('Add health check', 'full-auto');

    // Should have system messages for phase transitions
    const systemMessages = conversation.messages.filter((m) => m.sender === 'system');
    expect(systemMessages.length).toBeGreaterThan(0);
  });

  it('gates fire in discuss-all mode', async () => {
    config = BuildConfigSchema.parse({
      ...config,
      defaultAutonomyLevel: 'discuss-all',
    });
    const orchestrator = new BuildOrchestrator(checkpoint, conversation, config, createMockStrategyExecutor());
    await orchestrator.start('Add feature', 'discuss-all');

    // Should have gate decisions for specify, design, plan, review
    expect(conversation.gateDecisions.length).toBeGreaterThanOrEqual(1);
  });

  it('evidence report has required fields', async () => {
    const orchestrator = new BuildOrchestrator(checkpoint, conversation, config, createMockStrategyExecutor());
    const report = await orchestrator.start('Add endpoint', 'full-auto');

    expect(report.requirement).toBe('Add endpoint');
    expect(report.verdict).toBeDefined();
    expect(report.delivery).toBeDefined();
    expect(report.delivery.totalCost).toBeDefined();
    expect(report.delivery.humanInterventions).toBeDefined();
    expect(Array.isArray(report.phases)).toBe(true);
    expect(Array.isArray(report.refinements)).toBe(true);
  });
});
