// SPDX-License-Identifier: Apache-2.0
/**
 * ConversationPort — Human-agent conversation for Build Orchestrator gates.
 *
 * Provides the communication channel between the orchestrator agent and
 * the human via the dashboard conversation panel. Supports rich cards,
 * threading, per-gate action buttons, and on-demand skill invocation.
 *
 * @see PRD 047 — Build Orchestrator §Surfaces
 */

import type { ConversationMessage } from './checkpoint.js';

// ── Port Interface ──

export interface ConversationPort {
  /** Send a message from the orchestrator to the human (renders in chat panel). */
  sendAgentMessage(buildId: string, message: AgentMessage): Promise<void>;
  /** Send a system notification (phase transition, checkpoint, status). */
  sendSystemMessage(buildId: string, message: string): Promise<void>;
  /** Wait for the human to respond (blocks until message received via UI). */
  waitForHumanMessage(buildId: string): Promise<HumanMessage>;
  /** Wait for a gate decision (blocks until approve/reject via UI). */
  waitForGateDecision(buildId: string, gate: GateType): Promise<GateDecision>;
  /** Get full conversation history for a build. */
  getHistory(buildId: string): Promise<ConversationMessage[]>;
  /** Human requests an optional skill invocation mid-pipeline. */
  requestSkillInvocation(buildId: string, skill: SkillRequest): Promise<void>;
  /** Deliver a human message from the REST route (resolves waitForHumanMessage). */
  receiveHumanMessage(buildId: string, message: HumanMessage): void;
  /** Deliver a gate decision from the REST route (resolves waitForGateDecision). */
  receiveGateDecision(buildId: string, decision: GateDecision): void;
}

// ── Message Types ──

export interface AgentMessage {
  readonly type: "text" | "card" | "artifact";
  readonly content: string;
  readonly card?: StructuredCard;
  readonly replyTo?: string;
}

export interface HumanMessage {
  readonly content: string;
  readonly replyTo?: string;
}

export interface GateDecision {
  readonly gate: GateType;
  readonly decision: "approve" | "reject" | "adjust";
  readonly feedback?: string;
  readonly adjustments?: Record<string, unknown>;
}

// ── Gate Types ──

export type GateType = "specify" | "design" | "plan" | "review" | "escalation";

/** Per-gate action sets rendered by the UI. */
export const GATE_ACTIONS: Record<GateType, readonly string[]> = {
  specify: ["Approve Spec"],
  design: ["Approve Design"],
  plan: ["Approve Plan"],
  review: ["Approve", "Approve with Comments", "Request Changes"],
  escalation: ["Retry with Direction", "Fix Manually", "Abort"],
} as const;

// ── Skill Invocation ──

export type SkillRequest =
  | { type: "debate"; context: string }
  | { type: "review"; commissionId?: string; context: string }
  | { type: "surface"; domains: [string, string]; description: string };

// ── Structured Cards ──

export interface StructuredCard {
  readonly type: "feature-spec" | "prd-summary" | "commission-plan" | "review-findings" | "evidence-report" | "debate-decision";
  readonly data: Record<string, unknown>;
}
