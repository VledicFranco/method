/**
 * ConversationAdapter — In-memory ConversationPort implementation for the Build Orchestrator.
 *
 * Provides the communication channel between the orchestrator agent and the human
 * via the dashboard conversation panel. Messages are stored in-memory and also
 * persisted to JSONL for resume-after-restart.
 *
 * @see PRD 047 — Build Orchestrator §Surfaces
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';

import type { ConversationPort, AgentMessage, HumanMessage, GateDecision, GateType, SkillRequest } from '../../ports/conversation.js';
import type { ConversationMessage } from '../../ports/checkpoint.js';

// ── Event callback type ────────────────────────────────────────

export type ConversationEventCallback = (event: ConversationEvent) => void;

export type ConversationEvent =
  | { type: 'build.agent_message'; buildId: string; message: ConversationMessage }
  | { type: 'build.system_message'; buildId: string; message: ConversationMessage }
  | { type: 'build.skill_request'; buildId: string; skill: SkillRequest };

// ── Pending resolver types ─────────────────────────────────────

interface PendingHumanMessage {
  resolve: (message: HumanMessage) => void;
}

interface PendingGateDecision {
  resolve: (decision: GateDecision) => void;
}

// ── Adapter Options ────────────────────────────────────────────

export interface ConversationAdapterOptions {
  /** Base directory for session data. Conversation JSONL files are stored at {sessionDir}/{buildId}/conversation.jsonl */
  sessionDir: string;
  /** Optional event callback — wired to the event bus in C-3. */
  onEvent?: ConversationEventCallback;
}

// ── ConversationAdapter ────────────────────────────────────────

export class ConversationAdapter implements ConversationPort {
  private readonly store = new Map<string, ConversationMessage[]>();
  private readonly pendingHumanMessages = new Map<string, PendingHumanMessage>();
  private readonly pendingGateDecisions = new Map<string, PendingGateDecision>();
  private readonly sessionDir: string;
  private readonly onEvent?: ConversationEventCallback;

  constructor(options: ConversationAdapterOptions) {
    this.sessionDir = options.sessionDir;
    this.onEvent = options.onEvent;
  }

  // ── ConversationPort implementation ──────────────────────────

  async sendAgentMessage(buildId: string, message: AgentMessage): Promise<void> {
    const msg = this.createMessage(buildId, 'agent', message.content, message.replyTo, message.card);
    this.pushMessage(buildId, msg);
    await this.persistMessage(buildId, msg);

    this.onEvent?.({
      type: 'build.agent_message',
      buildId,
      message: msg,
    });
  }

  async sendSystemMessage(buildId: string, content: string): Promise<void> {
    const msg = this.createMessage(buildId, 'system', content);
    this.pushMessage(buildId, msg);
    await this.persistMessage(buildId, msg);

    this.onEvent?.({
      type: 'build.system_message',
      buildId,
      message: msg,
    });
  }

  waitForHumanMessage(buildId: string): Promise<HumanMessage> {
    return new Promise<HumanMessage>((resolve) => {
      this.pendingHumanMessages.set(buildId, { resolve });
    });
  }

  waitForGateDecision(buildId: string, _gate: GateType): Promise<GateDecision> {
    return new Promise<GateDecision>((resolve) => {
      this.pendingGateDecisions.set(buildId, { resolve });
    });
  }

  async getHistory(buildId: string): Promise<ConversationMessage[]> {
    const inMemory = this.store.get(buildId);
    if (inMemory && inMemory.length > 0) {
      return [...inMemory];
    }

    // Attempt to load from JSONL if in-memory store is empty
    const loaded = await this.loadFromJsonl(buildId);
    if (loaded.length > 0) {
      this.store.set(buildId, loaded);
    }
    return loaded;
  }

  async requestSkillInvocation(buildId: string, skill: SkillRequest): Promise<void> {
    this.onEvent?.({
      type: 'build.skill_request',
      buildId,
      skill,
    });
  }

  // ── Public methods for external callers (REST routes in C-3) ──

  /**
   * Called by REST routes when a human sends a message via the UI.
   * Stores the message and resolves any pending waitForHumanMessage promise.
   */
  async receiveHumanMessage(buildId: string, message: HumanMessage): Promise<void> {
    const msg = this.createMessage(buildId, 'human', message.content, message.replyTo);
    this.pushMessage(buildId, msg);
    await this.persistMessage(buildId, msg);

    const pending = this.pendingHumanMessages.get(buildId);
    if (pending) {
      this.pendingHumanMessages.delete(buildId);
      pending.resolve(message);
    }
  }

  /**
   * Called by REST routes when a human makes a gate decision via the UI.
   * Resolves any pending waitForGateDecision promise.
   */
  receiveGateDecision(buildId: string, decision: GateDecision): void {
    const pending = this.pendingGateDecisions.get(buildId);
    if (pending) {
      this.pendingGateDecisions.delete(buildId);
      pending.resolve(decision);
    }
  }

  // ── Internal helpers ─────────────────────────────────────────

  private createMessage(
    _buildId: string,
    sender: ConversationMessage['sender'],
    content: string,
    replyTo?: string,
    card?: unknown,
  ): ConversationMessage {
    return {
      id: randomUUID(),
      sender,
      content,
      timestamp: new Date().toISOString(),
      ...(replyTo ? { replyTo } : {}),
      ...(card ? { card } : {}),
    };
  }

  private pushMessage(buildId: string, msg: ConversationMessage): void {
    let messages = this.store.get(buildId);
    if (!messages) {
      messages = [];
      this.store.set(buildId, messages);
    }
    messages.push(msg);
  }

  private jsonlPath(buildId: string): string {
    return join(this.sessionDir, buildId, 'conversation.jsonl');
  }

  private async persistMessage(buildId: string, msg: ConversationMessage): Promise<void> {
    const filePath = this.jsonlPath(buildId);
    const dir = join(this.sessionDir, buildId);
    await mkdir(dir, { recursive: true });
    await appendFile(filePath, JSON.stringify(msg) + '\n', 'utf-8');
  }

  private async loadFromJsonl(buildId: string): Promise<ConversationMessage[]> {
    const filePath = this.jsonlPath(buildId);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      return lines.map((line) => JSON.parse(line) as ConversationMessage);
    } catch {
      // File doesn't exist or read error — return empty
      return [];
    }
  }
}
