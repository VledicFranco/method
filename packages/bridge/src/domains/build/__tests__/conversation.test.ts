/**
 * ConversationAdapter — unit tests (PRD 047 C-2).
 *
 * Tests cover:
 * - sendAgentMessage adds to store and is retrievable via getHistory
 * - waitForHumanMessage resolves when receiveHumanMessage is called
 * - waitForGateDecision resolves when receiveGateDecision is called
 * - Messages persist to JSONL and reload after clearing in-memory store
 * - Event callbacks fire on message sends and skill requests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { ConversationAdapter } from '../conversation-adapter.js';
import type { ConversationEvent } from '../conversation-adapter.js';
import type { AgentMessage, HumanMessage, GateDecision } from '../../../ports/conversation.js';

// ── Test setup ─────────────────────────────────────────────────

let testSessionDir: string;

before(async () => {
  testSessionDir = join(tmpdir(), `method-bridge-conv-test-${Date.now()}`);
  await fsPromises.mkdir(testSessionDir, { recursive: true });
});

after(async () => {
  try {
    await fsPromises.rm(testSessionDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup
  }
});

// ── Helpers ────────────────────────────────────────────────────

function createAdapter(events?: ConversationEvent[]): ConversationAdapter {
  return new ConversationAdapter({
    sessionDir: testSessionDir,
    onEvent: events ? (e) => events.push(e) : undefined,
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe('ConversationAdapter', () => {
  describe('sendAgentMessage + getHistory', () => {
    it('stores an agent message and returns it via getHistory', async () => {
      const adapter = createAdapter();
      const buildId = `build-agent-${Date.now()}`;

      const agentMsg: AgentMessage = {
        type: 'text',
        content: 'Hello from the orchestrator',
      };

      await adapter.sendAgentMessage(buildId, agentMsg);
      const history = await adapter.getHistory(buildId);

      assert.equal(history.length, 1);
      assert.equal(history[0].sender, 'agent');
      assert.equal(history[0].content, 'Hello from the orchestrator');
      assert.ok(history[0].id, 'message should have an id');
      assert.ok(history[0].timestamp, 'message should have a timestamp');
    });

    it('stores multiple messages in order', async () => {
      const adapter = createAdapter();
      const buildId = `build-multi-${Date.now()}`;

      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'first' });
      await adapter.sendSystemMessage(buildId, 'system note');
      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'second' });

      const history = await adapter.getHistory(buildId);

      assert.equal(history.length, 3);
      assert.equal(history[0].content, 'first');
      assert.equal(history[0].sender, 'agent');
      assert.equal(history[1].content, 'system note');
      assert.equal(history[1].sender, 'system');
      assert.equal(history[2].content, 'second');
      assert.equal(history[2].sender, 'agent');
    });

    it('emits build.agent_message event', async () => {
      const events: ConversationEvent[] = [];
      const adapter = createAdapter(events);
      const buildId = `build-event-${Date.now()}`;

      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'event test' });

      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'build.agent_message');
      assert.equal(events[0].buildId, buildId);
    });

    it('emits build.system_message event', async () => {
      const events: ConversationEvent[] = [];
      const adapter = createAdapter(events);
      const buildId = `build-sys-event-${Date.now()}`;

      await adapter.sendSystemMessage(buildId, 'system event test');

      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'build.system_message');
      assert.equal(events[0].buildId, buildId);
    });
  });

  describe('waitForHumanMessage + receiveHumanMessage', () => {
    it('resolves when receiveHumanMessage is called', async () => {
      const adapter = createAdapter();
      const buildId = `build-human-${Date.now()}`;

      const humanMsg: HumanMessage = {
        content: 'Looks good, proceed',
      };

      // Start waiting (non-blocking)
      const waitPromise = adapter.waitForHumanMessage(buildId);

      // Simulate human response after a short delay
      setTimeout(() => {
        adapter.receiveHumanMessage(buildId, humanMsg);
      }, 10);

      const result = await waitPromise;
      assert.equal(result.content, 'Looks good, proceed');
    });

    it('stores the human message in history', async () => {
      const adapter = createAdapter();
      const buildId = `build-human-hist-${Date.now()}`;

      await adapter.receiveHumanMessage(buildId, { content: 'human says hi' });

      const history = await adapter.getHistory(buildId);
      assert.equal(history.length, 1);
      assert.equal(history[0].sender, 'human');
      assert.equal(history[0].content, 'human says hi');
    });
  });

  describe('waitForGateDecision + receiveGateDecision', () => {
    it('resolves when receiveGateDecision is called', async () => {
      const adapter = createAdapter();
      const buildId = `build-gate-${Date.now()}`;

      const decision: GateDecision = {
        gate: 'specify',
        decision: 'approve',
        feedback: 'Spec looks solid',
      };

      // Start waiting (non-blocking)
      const waitPromise = adapter.waitForGateDecision(buildId, 'specify');

      // Simulate gate decision after a short delay
      setTimeout(() => {
        adapter.receiveGateDecision(buildId, decision);
      }, 10);

      const result = await waitPromise;
      assert.equal(result.gate, 'specify');
      assert.equal(result.decision, 'approve');
      assert.equal(result.feedback, 'Spec looks solid');
    });

    it('handles reject decisions with adjustments', async () => {
      const adapter = createAdapter();
      const buildId = `build-gate-reject-${Date.now()}`;

      const decision: GateDecision = {
        gate: 'review',
        decision: 'reject',
        feedback: 'Missing error handling',
        adjustments: { focus: 'error-paths' },
      };

      const waitPromise = adapter.waitForGateDecision(buildId, 'review');
      setTimeout(() => adapter.receiveGateDecision(buildId, decision), 10);

      const result = await waitPromise;
      assert.equal(result.decision, 'reject');
      assert.deepEqual(result.adjustments, { focus: 'error-paths' });
    });
  });

  describe('JSONL persistence', () => {
    it('persists messages to JSONL and reloads on getHistory if in-memory is empty', async () => {
      const buildId = `build-persist-${Date.now()}`;

      // Adapter 1: write messages
      const adapter1 = new ConversationAdapter({ sessionDir: testSessionDir });
      await adapter1.sendAgentMessage(buildId, { type: 'text', content: 'persisted msg 1' });
      await adapter1.sendSystemMessage(buildId, 'persisted system msg');

      // Adapter 2: fresh instance (empty in-memory store), same sessionDir
      const adapter2 = new ConversationAdapter({ sessionDir: testSessionDir });
      const history = await adapter2.getHistory(buildId);

      assert.equal(history.length, 2);
      assert.equal(history[0].content, 'persisted msg 1');
      assert.equal(history[0].sender, 'agent');
      assert.equal(history[1].content, 'persisted system msg');
      assert.equal(history[1].sender, 'system');
    });

    it('JSONL file contains valid JSON lines', async () => {
      const buildId = `build-jsonl-${Date.now()}`;
      const adapter = new ConversationAdapter({ sessionDir: testSessionDir });

      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'line 1' });
      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'line 2' });

      const filePath = join(testSessionDir, buildId, 'conversation.jsonl');
      const raw = await fsPromises.readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);

      assert.equal(lines.length, 2);
      // Each line should parse as valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.ok(parsed.id);
        assert.ok(parsed.sender);
        assert.ok(parsed.content);
        assert.ok(parsed.timestamp);
      }
    });
  });

  describe('requestSkillInvocation', () => {
    it('emits build.skill_request event', async () => {
      const events: ConversationEvent[] = [];
      const adapter = createAdapter(events);
      const buildId = `build-skill-${Date.now()}`;

      await adapter.requestSkillInvocation(buildId, {
        type: 'debate',
        context: 'Should we use SQL or NoSQL?',
      });

      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'build.skill_request');
      assert.equal(events[0].buildId, buildId);
      if (events[0].type === 'build.skill_request') {
        assert.equal(events[0].skill.type, 'debate');
      }
    });
  });

  describe('getHistory returns a copy', () => {
    it('mutations to returned array do not affect internal store', async () => {
      const adapter = createAdapter();
      const buildId = `build-copy-${Date.now()}`;

      await adapter.sendAgentMessage(buildId, { type: 'text', content: 'original' });
      const history1 = await adapter.getHistory(buildId);
      history1.push({ id: 'fake', sender: 'human', content: 'injected', timestamp: '' });

      const history2 = await adapter.getHistory(buildId);
      assert.equal(history2.length, 1, 'internal store should not be modified by external mutation');
    });
  });
});
