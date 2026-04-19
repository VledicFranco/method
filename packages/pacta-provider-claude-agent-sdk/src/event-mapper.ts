// SPDX-License-Identifier: Apache-2.0
/**
 * `mapSdkMessage` — translate a single Claude Agent SDK message into
 * zero or more pacta `AgentEvent`s.
 *
 * Mapping policy:
 *   - SDK `system init`            → `started`
 *   - SDK `assistant` text block   → `text`
 *   - SDK `assistant` tool_use     → `tool_use`
 *   - SDK `user`     tool_result   → `tool_result`
 *   - SDK `result`   success       → `completed` (with usage + cost)
 *   - SDK `result`   error         → `error` (recoverable=false)
 *   - Anything else                → no event (we don't crash)
 *
 * The mapper is pure: same input always produces the same output. The
 * factory iterates the SDK stream and feeds each message through here,
 * accumulating turns and final usage on its own.
 *
 * Streaming (C-3) will reuse this mapper for partial messages. C-1
 * needs only the post-hoc oneshot translation.
 */

import type {
  AgentEvent,
  TokenUsage,
  CostReport,
} from '@methodts/pacta';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  NonNullableUsage,
  ModelUsage,
} from '@anthropic-ai/claude-agent-sdk';

// ── Public API ───────────────────────────────────────────────────

/**
 * Map a single SDK message into pacta `AgentEvent`s. Returns an empty
 * array for SDK messages we don't surface (control messages, partial
 * deltas, etc.).
 */
export function mapSdkMessage(msg: SDKMessage): AgentEvent[] {
  // The SDK's `SDKMessage` union is wide. Discriminate on `type` first,
  // then `subtype` where present.
  switch (msg.type) {
    case 'system':
      return mapSystemMessage(msg as SDKSystemMessage);
    case 'assistant':
      return mapAssistantMessage(msg as SDKAssistantMessage);
    case 'user':
      return mapUserMessage(msg as SDKUserMessage);
    case 'result':
      return mapResultMessage(msg as SDKResultMessage);
    default:
      // Unknown / unhandled message types (stream_event, tool_progress,
      // hook_*, task_*, etc.) — silently drop. Don't crash on SDK
      // additions we haven't taught the mapper about.
      return [];
  }
}

// ── Per-type mappers ─────────────────────────────────────────────

function mapSystemMessage(msg: SDKSystemMessage): AgentEvent[] {
  // Only the `init` subtype maps to a pacta `started` event. Other
  // system subtypes (compact_boundary, notification, mirror_error,
  // etc.) are SDK-internal and not worth surfacing in v1.
  if (msg.subtype !== 'init') return [];
  return [{
    type: 'started',
    sessionId: msg.session_id,
    timestamp: new Date().toISOString(),
  }];
}

function mapAssistantMessage(msg: SDKAssistantMessage): AgentEvent[] {
  const events: AgentEvent[] = [];
  const blocks = msg.message?.content ?? [];

  for (const block of blocks) {
    // BetaContentBlock is a discriminated union; type is always set.
    const blockType = (block as { type?: string }).type;

    if (blockType === 'text') {
      const text = (block as { text?: string }).text ?? '';
      if (text.length > 0) {
        events.push({ type: 'text', content: text });
      }
    } else if (blockType === 'tool_use') {
      const toolBlock = block as { id: string; name: string; input: unknown };
      events.push({
        type: 'tool_use',
        tool: toolBlock.name,
        input: toolBlock.input,
        toolUseId: toolBlock.id,
      });
    } else if (blockType === 'thinking') {
      // BetaThinkingBlock — surface as pacta `thinking`.
      const content = (block as { thinking?: string }).thinking ?? '';
      if (content.length > 0) {
        events.push({ type: 'thinking', content });
      }
    }
    // Other block types (server tool blocks, web search results, etc.)
    // are not modeled by pacta in v1. Skip silently.
  }

  return events;
}

function mapUserMessage(msg: SDKUserMessage): AgentEvent[] {
  // We only surface user messages that carry tool_result blocks. The
  // SDK uses user messages for echoing the prompt back too, which is
  // not interesting to pacta consumers.
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];

  const events: AgentEvent[] = [];
  for (const block of content) {
    const blockType = (block as { type?: string }).type;
    if (blockType !== 'tool_result') continue;

    const trBlock = block as {
      tool_use_id: string;
      content?: unknown;
    };
    events.push({
      type: 'tool_result',
      // Anthropic's tool_result block doesn't carry the tool name
      // (it's correlated by id). The factory layer can join with the
      // earlier tool_use event if it cares; for v1 we emit empty.
      tool: '',
      output: trBlock.content,
      toolUseId: trBlock.tool_use_id,
      // The SDK doesn't surface a per-tool duration in the message;
      // 0 is the honest answer here.
      durationMs: 0,
    });
  }
  return events;
}

function mapResultMessage(msg: SDKResultMessage): AgentEvent[] {
  if (msg.subtype === 'success') {
    return [mapResultSuccess(msg)];
  }
  // Error subtype — surface as pacta `error`. The SDK's error result
  // includes `errors: string[]`; concatenate for the message.
  const errMsg = msg as { errors?: string[]; subtype: string };
  return [{
    type: 'error',
    message: (errMsg.errors ?? []).join('\n') || `SDK result error: ${errMsg.subtype}`,
    recoverable: false,
    code: errMsg.subtype,
  }];
}

function mapResultSuccess(msg: SDKResultSuccess): AgentEvent {
  const usage = mapUsage(msg.usage);
  const cost = mapCost(msg, usage);
  return {
    type: 'completed',
    result: msg.result,
    usage,
    cost,
    durationMs: msg.duration_ms,
    turns: msg.num_turns,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Convert SDK `NonNullableUsage` (Anthropic Beta usage shape) into
 * pacta `TokenUsage`. We only surface the four token counts pacta
 * tracks; everything else (server tool use, iterations, geo) is
 * dropped for v1.
 */
export function mapUsage(usage: NonNullableUsage): TokenUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

/**
 * Build a pacta `CostReport` from the SDK's result message. The SDK
 * already computed `total_cost_usd` and a per-model breakdown, so we
 * pass them through rather than recomputing.
 */
export function mapCost(
  msg: SDKResultSuccess,
  totalUsage: TokenUsage,
): CostReport {
  const perModel: Record<string, { tokens: TokenUsage; costUsd: number }> = {};

  if (msg.modelUsage) {
    for (const [model, mu] of Object.entries(msg.modelUsage)) {
      perModel[model] = {
        tokens: modelUsageToTokens(mu),
        costUsd: mu.costUSD ?? 0,
      };
    }
  }

  // If the SDK didn't break out a per-model entry (some result shapes
  // omit it on error paths), fall back to a single synthetic bucket.
  if (Object.keys(perModel).length === 0) {
    perModel['unknown'] = {
      tokens: totalUsage,
      costUsd: msg.total_cost_usd ?? 0,
    };
  }

  return {
    totalUsd: msg.total_cost_usd ?? 0,
    perModel,
  };
}

function modelUsageToTokens(mu: ModelUsage): TokenUsage {
  const inputTokens = mu.inputTokens ?? 0;
  const outputTokens = mu.outputTokens ?? 0;
  const cacheReadTokens = mu.cacheReadInputTokens ?? 0;
  const cacheWriteTokens = mu.cacheCreationInputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

/** Empty-usage helper for callers that need a zero baseline. */
export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}
