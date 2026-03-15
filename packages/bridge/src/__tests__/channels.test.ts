import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionChannels,
  appendMessage,
  readMessages,
  type Channel,
  type SessionChannels,
} from '../channels.js';

describe('Channel Infrastructure (PRD 008)', () => {
  // ── createSessionChannels() ───────────────────────────────────

  describe('createSessionChannels()', () => {
    it('creates progress and events channels with empty messages', () => {
      const channels = createSessionChannels();

      assert.ok(channels.progress);
      assert.ok(channels.events);
      assert.deepEqual(channels.progress.messages, []);
      assert.deepEqual(channels.events.messages, []);
    });

    it('channels have correct names', () => {
      const channels = createSessionChannels();

      assert.equal(channels.progress.name, 'progress');
      assert.equal(channels.events.name, 'events');
    });

    it('channels start with empty cursors', () => {
      const channels = createSessionChannels();

      assert.equal(channels.progress.cursors.size, 0);
      assert.equal(channels.events.cursors.size, 0);
    });
  });

  // ── appendMessage() ──────────────────────────────────────────

  describe('appendMessage()', () => {
    let channel: Channel;

    beforeEach(() => {
      const channels = createSessionChannels();
      channel = channels.progress;
    });

    it('appends a message with sequence starting at 1', () => {
      const seq = appendMessage(channel, 'session-abc', 'step_started', { step: 'sigma_0' });

      assert.equal(seq, 1);
      assert.equal(channel.messages.length, 1);
      assert.equal(channel.messages[0].sequence, 1);
    });

    it('sequential appends get monotonically increasing sequences', () => {
      const seq1 = appendMessage(channel, 'session-abc', 'step_started', { step: 'sigma_0' });
      const seq2 = appendMessage(channel, 'session-abc', 'working_on', { desc: 'loading YAML' });
      const seq3 = appendMessage(channel, 'session-abc', 'step_completed', { step: 'sigma_0' });

      assert.equal(seq1, 1);
      assert.equal(seq2, 2);
      assert.equal(seq3, 3);
      assert.ok(seq1 < seq2);
      assert.ok(seq2 < seq3);
    });

    it('message has correct ISO 8601 timestamp format', () => {
      appendMessage(channel, 'session-abc', 'step_started', { step: 'sigma_0' });

      const msg = channel.messages[0];
      // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      assert.match(msg.timestamp, isoRegex);

      // Also verify it parses as a valid date
      const parsed = new Date(msg.timestamp);
      assert.ok(!isNaN(parsed.getTime()));
    });

    it('message has correct sender, type, and content', () => {
      const content = { step: 'sigma_0', methodology: 'P2-SD' };
      appendMessage(channel, 'agent-42', 'step_started', content);

      const msg = channel.messages[0];
      assert.equal(msg.sender, 'agent-42');
      assert.equal(msg.type, 'step_started');
      assert.deepEqual(msg.content, content);
    });

    it('returns the sequence number', () => {
      const seq = appendMessage(channel, 'session-abc', 'info', { detail: 'test' });
      assert.equal(typeof seq, 'number');
      assert.equal(seq, 1);
    });
  });

  // ── readMessages() ───────────────────────────────────────────

  describe('readMessages()', () => {
    let channel: Channel;

    beforeEach(() => {
      const channels = createSessionChannels();
      channel = channels.progress;
      appendMessage(channel, 'agent-1', 'step_started', { step: 'sigma_0' });
      appendMessage(channel, 'agent-1', 'working_on', { desc: 'validating schema' });
      appendMessage(channel, 'agent-1', 'step_completed', { step: 'sigma_0' });
    });

    it('returns all messages when sinceSequence is 0', () => {
      const result = readMessages(channel, 0);

      assert.equal(result.messages.length, 3);
      assert.equal(result.messages[0].sequence, 1);
      assert.equal(result.messages[1].sequence, 2);
      assert.equal(result.messages[2].sequence, 3);
    });

    it('returns only messages after sinceSequence', () => {
      const result = readMessages(channel, 2);

      assert.equal(result.messages.length, 1);
      assert.equal(result.messages[0].sequence, 3);
      assert.equal(result.messages[0].type, 'step_completed');
    });

    it('returns empty array when no messages match', () => {
      const result = readMessages(channel, 3);

      assert.equal(result.messages.length, 0);
    });

    it('returns correct last_sequence', () => {
      const result = readMessages(channel, 0);
      assert.equal(result.last_sequence, 3);

      const result2 = readMessages(channel, 2);
      assert.equal(result2.last_sequence, 3);
    });

    it('returns sinceSequence as last_sequence when no messages match', () => {
      const result = readMessages(channel, 99);
      assert.equal(result.last_sequence, 99);
    });

    it('updates cursor when readerId is provided', () => {
      readMessages(channel, 0, 'parent-agent');

      assert.equal(channel.cursors.get('parent-agent'), 3);
    });

    it('does not create cursor when readerId is omitted', () => {
      readMessages(channel, 0);

      assert.equal(channel.cursors.size, 0);
    });

    it('has_more is false (MVP — no pagination)', () => {
      const result = readMessages(channel, 0);
      assert.equal(result.has_more, false);

      const result2 = readMessages(channel, 2);
      assert.equal(result2.has_more, false);
    });
  });

  // ── Message cap (1000 limit) ─────────────────────────────────

  describe('message cap (1000 limit)', () => {
    it('after 1001 appends, only 1000 messages remain', () => {
      const channels = createSessionChannels();
      const channel = channels.progress;

      for (let i = 0; i < 1001; i++) {
        appendMessage(channel, 'agent-bulk', 'tick', { index: i });
      }

      assert.equal(channel.messages.length, 1000);
    });

    it('the evicted message is the oldest (first appended)', () => {
      const channels = createSessionChannels();
      const channel = channels.progress;

      for (let i = 0; i < 1001; i++) {
        appendMessage(channel, 'agent-bulk', 'tick', { index: i });
      }

      // The first message (index: 0, sequence: 1) should have been evicted
      const firstRemaining = channel.messages[0];
      assert.equal(firstRemaining.sequence, 2);
      assert.deepEqual(firstRemaining.content, { index: 1 });
    });

    it('the newest message is preserved', () => {
      const channels = createSessionChannels();
      const channel = channels.progress;

      for (let i = 0; i < 1001; i++) {
        appendMessage(channel, 'agent-bulk', 'tick', { index: i });
      }

      const lastMsg = channel.messages[channel.messages.length - 1];
      assert.equal(lastMsg.sequence, 1001);
      assert.deepEqual(lastMsg.content, { index: 1000 });
    });
  });

  // ── Real scenario: methodology step progression ──────────────

  describe('real scenario: methodology step progression', () => {
    it('simulates agent working through methodology steps', () => {
      const channels = createSessionChannels();
      const ch = channels.progress;
      const sessionId = 'session-method-run-42';

      // 1. Agent starts sigma_0
      appendMessage(ch, sessionId, 'step_started', {
        step: 'sigma_0',
        methodology: 'P2-SD',
        label: 'Orientation',
      });

      // 2. Agent reports what it is working on
      appendMessage(ch, sessionId, 'working_on', {
        description: 'Reading project card and delivery rules',
      });

      // 3. Agent completes sigma_0
      appendMessage(ch, sessionId, 'step_completed', {
        step: 'sigma_0',
        duration_ms: 4500,
      });

      // 4. Agent starts sigma_1
      appendMessage(ch, sessionId, 'step_started', {
        step: 'sigma_1',
        methodology: 'P2-SD',
        label: 'Discovery',
      });

      // 5. Read all progress — should have 4 messages
      const allMessages = readMessages(ch, 0);
      assert.equal(allMessages.messages.length, 4);
      assert.equal(allMessages.last_sequence, 4);

      // 6. Read since sequence 2 — should have 2 messages
      const recentMessages = readMessages(ch, 2);
      assert.equal(recentMessages.messages.length, 2);
      assert.equal(recentMessages.messages[0].type, 'step_completed');
      assert.equal(recentMessages.messages[1].type, 'step_started');
      assert.deepEqual(recentMessages.messages[1].content.step, 'sigma_1');

      // Verify timestamps are in chronological order
      for (let i = 1; i < allMessages.messages.length; i++) {
        const prev = new Date(allMessages.messages[i - 1].timestamp).getTime();
        const curr = new Date(allMessages.messages[i].timestamp).getTime();
        assert.ok(curr >= prev, `Message ${i} timestamp should be >= message ${i - 1}`);
      }
    });
  });

  // ── Real scenario: event lifecycle ───────────────────────────

  describe('real scenario: event lifecycle', () => {
    it('tracks session events from start to completion', () => {
      const channels = createSessionChannels();
      const ch = channels.events;

      // Bridge auto-generates a 'started' event when session spawns
      appendMessage(ch, 'bridge', 'started', {
        session_id: 'session-xyz',
        workdir: '/home/user/project',
        methodology: 'P2-SD',
        spawned_at: new Date().toISOString(),
      });

      // Bridge generates a 'completed' event when session finishes
      appendMessage(ch, 'bridge', 'completed', {
        session_id: 'session-xyz',
        result: 'success',
        prompts_sent: 12,
        total_duration_ms: 45000,
      });

      // Read all events — should have 2 messages
      const result = readMessages(ch, 0);
      assert.equal(result.messages.length, 2);

      // Verify content fields are preserved exactly
      const startedEvent = result.messages[0];
      assert.equal(startedEvent.sender, 'bridge');
      assert.equal(startedEvent.type, 'started');
      assert.equal(startedEvent.content.session_id, 'session-xyz');
      assert.equal(startedEvent.content.workdir, '/home/user/project');
      assert.equal(startedEvent.content.methodology, 'P2-SD');

      const completedEvent = result.messages[1];
      assert.equal(completedEvent.sender, 'bridge');
      assert.equal(completedEvent.type, 'completed');
      assert.equal(completedEvent.content.result, 'success');
      assert.equal(completedEvent.content.prompts_sent, 12);
      assert.equal(completedEvent.content.total_duration_ms, 45000);
    });
  });

  // ── Cursor isolation ─────────────────────────────────────────

  describe('cursor isolation', () => {
    it('two readers have independent cursors on the same channel', () => {
      const channels = createSessionChannels();
      const ch = channels.progress;

      // Append initial messages
      appendMessage(ch, 'worker', 'step_started', { step: 'sigma_0' });
      appendMessage(ch, 'worker', 'step_completed', { step: 'sigma_0' });

      // Reader 1 reads all messages
      const r1First = readMessages(ch, 0, 'orchestrator');
      assert.equal(r1First.messages.length, 2);
      assert.equal(ch.cursors.get('orchestrator'), 2);

      // Reader 2 reads all messages
      const r2First = readMessages(ch, 0, 'dashboard');
      assert.equal(r2First.messages.length, 2);
      assert.equal(ch.cursors.get('dashboard'), 2);

      // New message arrives
      appendMessage(ch, 'worker', 'step_started', { step: 'sigma_1' });

      // Reader 1 reads new messages using its cursor
      const cursor1 = ch.cursors.get('orchestrator')!;
      const r1Second = readMessages(ch, cursor1, 'orchestrator');
      assert.equal(r1Second.messages.length, 1);
      assert.equal(r1Second.messages[0].type, 'step_started');
      assert.deepEqual(r1Second.messages[0].content, { step: 'sigma_1' });
      assert.equal(ch.cursors.get('orchestrator'), 3);

      // Reader 2 hasn't read yet — using its cursor still shows the new message
      const cursor2 = ch.cursors.get('dashboard')!;
      const r2Second = readMessages(ch, cursor2, 'dashboard');
      assert.equal(r2Second.messages.length, 1);
      assert.equal(ch.cursors.get('dashboard'), 3);

      // Another new message
      appendMessage(ch, 'worker', 'working_on', { desc: 'analyzing dependencies' });

      // Reader 1 reads again — only 1 new message
      const cursor1b = ch.cursors.get('orchestrator')!;
      const r1Third = readMessages(ch, cursor1b, 'orchestrator');
      assert.equal(r1Third.messages.length, 1);
      assert.equal(r1Third.messages[0].type, 'working_on');
      assert.equal(ch.cursors.get('orchestrator'), 4);

      // Reader 2 hasn't read — using its cursor shows 1 new message too
      const cursor2b = ch.cursors.get('dashboard')!;
      const r2Third = readMessages(ch, cursor2b, 'dashboard');
      assert.equal(r2Third.messages.length, 1);
      assert.equal(ch.cursors.get('dashboard'), 4);
    });
  });
});
