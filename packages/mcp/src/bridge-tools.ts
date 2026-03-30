/**
 * Bridge proxy tool handlers — factory pattern.
 *
 * Each bridge tool follows the same shape: parse input -> build request -> fetch bridge -> format response.
 * The factory `createBridgeHandler` eliminates the boilerplate.
 *
 * Extracted from index.ts to reduce monolith size. All tool schema definitions
 * (ListToolsRequestSchema) remain in index.ts — the MCP SDK requires them there.
 */

import { z } from "zod";
import {
  bridgeSpawnInput,
  bridgeSpawnBatchInput,
  bridgePromptInput,
  bridgeKillInput,
  bridgeProgressInput,
  bridgeEventInput,
  bridgeReadChannelInput,
  bridgeAllEventsInput,
  strategyExecuteInput,
  strategyStatusInput,
  strategyCreateInput,
  strategyUpdateInput,
  strategyDeleteInput,
  strategyExecutionStatusInput,
  strategyResumeInput,
  strategyAbortInput,
  triggerListInput,
  triggerIdInput,
  resourceCopyMethodologyInput,
  resourceCopyStrategyInput,
  projectIdInput,
  projectReadEventsInput,
  genesisReportInput,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

type BridgeFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a bridge proxy tool handler.
 * Handles: parse input -> build request -> fetch bridge -> format response.
 */
function createBridgeHandler<T extends z.ZodRawShape>(config: {
  schema: z.ZodObject<T>;
  handler: (parsed: z.infer<z.ZodObject<T>>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult>;
}): (args: Record<string, unknown>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult> {
  return async (args, bridgeFetch, bridgeUrl) => {
    const parsed = config.schema.parse(args);
    return config.handler(parsed, bridgeFetch, bridgeUrl);
  };
}

// ---------------------------------------------------------------------------
// Spawn session body builder (shared between spawn and spawn_batch)
// ---------------------------------------------------------------------------

function buildSpawnBody(s: z.infer<typeof bridgeSpawnInput>): Record<string, unknown> {
  const body: Record<string, unknown> = { workdir: s.workdir };
  if (s.spawn_args) body.spawn_args = s.spawn_args;
  if (s.initial_prompt) body.initial_prompt = s.initial_prompt;
  // Auto-correlate methodology session ID
  if (s.session_id) {
    body.metadata = { methodology_session_id: s.session_id };
  }
  // PRD 007: agent identity
  if (s.nickname) body.nickname = s.nickname;
  if (s.purpose) body.purpose = s.purpose;
  // PRD 006: parent-child chain fields
  if (s.parent_session_id) body.parent_session_id = s.parent_session_id;
  if (s.depth !== undefined) body.depth = s.depth;
  if (s.budget) body.budget = s.budget;
  // PRD 006 Component 2: worktree isolation
  if (s.isolation) body.isolation = s.isolation;
  // PRD 006 Component 4: stale timeout
  if (s.timeout_ms !== undefined) body.timeout_ms = s.timeout_ms;
  // PRD 012 Phase 4: session mode
  if (s.mode) body.mode = s.mode;
  // PRD 014: scope enforcement
  if (s.allowed_paths) body.allowed_paths = s.allowed_paths;
  if (s.scope_mode) body.scope_mode = s.scope_mode;
  // PRD 033/040: cognitive-agent mode
  if (s.provider_type) body.provider_type = s.provider_type;
  if (s.cognitive_config) body.cognitive_config = s.cognitive_config;
  // LLM provider selection for cognitive-agent mode
  if (s.llm_provider) body.llm_provider = s.llm_provider;
  if (s.llm_config) body.llm_config = s.llm_config;
  return body;
}

// ---------------------------------------------------------------------------
// Handler definitions
// ---------------------------------------------------------------------------

const bridge_spawn = createBridgeHandler({
  schema: bridgeSpawnInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const body = buildSpawnBody(parsed);

    const res = await bridgeFetch(`${bridgeUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as {
      session_id: string;
      nickname: string;
      status: string;
      mode?: string;
      depth?: number;
      parent_session_id?: string | null;
      budget?: { max_depth: number; max_agents: number; agents_spawned: number };
      isolation?: string;
      worktree_path?: string | null;
      metals_available?: boolean;
    };
    return ok(JSON.stringify({
      bridge_session_id: data.session_id,
      nickname: data.nickname,
      status: data.status,
      mode: data.mode ?? 'pty',
      depth: data.depth ?? 0,
      parent_session_id: data.parent_session_id ?? null,
      budget: data.budget ?? null,
      isolation: data.isolation ?? 'shared',
      worktree_path: data.worktree_path ?? null,
      metals_available: data.metals_available ?? true,
      message: data.isolation === 'worktree'
        ? `Agent '${data.nickname}' spawned in worktree: ${data.worktree_path}. Metals MCP NOT available. Call bridge_prompt to send work.`
        : `Agent '${data.nickname}' spawned (${data.mode ?? 'pty'} mode). Call bridge_prompt to send work.`,
    }, null, 2));
  },
});

const bridge_spawn_batch = createBridgeHandler({
  schema: bridgeSpawnBatchInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    // Build batch request body
    const batchBody: Record<string, unknown> = {
      sessions: parsed.sessions.map(s => buildSpawnBody(s)),
    };
    if (parsed.stagger_ms !== undefined) batchBody.stagger_ms = parsed.stagger_ms;

    const batchRes = await bridgeFetch(`${bridgeUrl}/sessions/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
    });

    const batchData = await batchRes.json() as {
      sessions: Array<{
        session_id: string;
        nickname: string;
        status: string;
        mode?: string;
        depth: number;
        parent_session_id: string | null;
        budget: { max_depth: number; max_agents: number; agents_spawned: number };
        isolation: string;
        worktree_path: string | null;
        metals_available: boolean;
        error?: string;
      }>;
      stagger_ms: number;
      spawned: number;
      failed: number;
    };

    const formatted = batchData.sessions.map(s => ({
      bridge_session_id: s.session_id,
      nickname: s.nickname,
      status: s.status,
      mode: s.mode ?? 'pty',
      depth: s.depth,
      parent_session_id: s.parent_session_id,
      budget: s.budget,
      isolation: s.isolation,
      worktree_path: s.worktree_path,
      metals_available: s.metals_available,
      ...(s.error ? { error: s.error } : {}),
    }));

    return ok(JSON.stringify({
      sessions: formatted,
      stagger_ms: batchData.stagger_ms,
      spawned: batchData.spawned,
      failed: batchData.failed,
      message: `Batch spawn: ${batchData.spawned} spawned, ${batchData.failed} failed (stagger: ${batchData.stagger_ms}ms)`,
    }, null, 2));
  },
});

const bridge_prompt = createBridgeHandler({
  schema: bridgePromptInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const body: Record<string, unknown> = { prompt: parsed.prompt };
    if (parsed.timeout_ms !== undefined) body.timeout_ms = parsed.timeout_ms;

    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { output: string; timed_out: boolean };
    const charCount = data.output.length;
    return ok(JSON.stringify({
      output: data.output,
      timed_out: data.timed_out,
      message: data.timed_out
        ? "Prompt timed out — partial output returned"
        : `Response received (${charCount} chars)`,
    }, null, 2));
  },
});

const bridge_kill = createBridgeHandler({
  schema: bridgeKillInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktree_action: parsed.worktree_action }),
    });

    const data = await res.json() as { session_id: string; killed: boolean; worktree_cleaned?: boolean };
    return ok(JSON.stringify({
      bridge_session_id: data.session_id,
      killed: data.killed,
      worktree_cleaned: data.worktree_cleaned ?? false,
      message: data.worktree_cleaned ? "Session killed, worktree cleaned" : "Session killed",
    }, null, 2));
  },
});

const bridge_list = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const [sessionsRes, statsRes] = await Promise.all([
      bridgeFetch(`${bridgeUrl}/sessions`),
      bridgeFetch(`${bridgeUrl}/pool/stats`),
    ]);

    const bridgeSessions = await sessionsRes.json() as Array<{
      session_id: string;
      nickname: string;
      purpose: string | null;
      status: string;
      queue_depth: number;
      metadata?: Record<string, unknown>;
      parent_session_id?: string | null;
      depth?: number;
      children?: string[];
      budget?: { max_depth: number; max_agents: number; agents_spawned: number };
    }>;

    const poolStats = await statsRes.json() as {
      max_sessions: number;
      active_count: number;
      dead_count: number;
      total_spawned: number;
      uptime_ms: number;
    };

    const formatted = bridgeSessions.map(s => ({
      bridge_session_id: s.session_id,
      nickname: s.nickname,
      purpose: s.purpose ?? null,
      status: s.status,
      queue_depth: s.queue_depth,
      metadata: s.metadata ?? {},
      methodology_session_id: (s.metadata as Record<string, unknown>)?.methodology_session_id ?? null,
      parent_session_id: s.parent_session_id ?? null,
      depth: s.depth ?? 0,
      children: s.children ?? [],
      budget: s.budget ?? null,
    }));

    return ok(JSON.stringify({
      sessions: formatted,
      pool: poolStats,
      message: `${poolStats.active_count} of ${poolStats.max_sessions} sessions active (${poolStats.total_spawned} total spawned)`,
    }, null, 2));
  },
});

const bridge_progress = createBridgeHandler({
  schema: bridgeProgressInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}/channels/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: parsed.type, content: parsed.content ?? {}, sender: parsed.bridge_session_id }),
    });

    const data = await res.json() as { sequence: number; acknowledged: boolean };
    return ok(JSON.stringify({
      sequence: data.sequence,
      acknowledged: data.acknowledged,
      message: `Progress reported: ${parsed.type}`,
    }, null, 2));
  },
});

const bridge_event = createBridgeHandler({
  schema: bridgeEventInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}/channels/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: parsed.type, content: parsed.content ?? {}, sender: parsed.bridge_session_id }),
    });

    const data = await res.json() as { sequence: number; acknowledged: boolean };
    return ok(JSON.stringify({
      sequence: data.sequence,
      acknowledged: data.acknowledged,
      message: `Event reported: ${parsed.type}`,
    }, null, 2));
  },
});

const bridge_read_progress = createBridgeHandler({
  schema: bridgeReadChannelInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const qs = parsed.since_sequence !== undefined ? `?since_sequence=${parsed.since_sequence}` : '';
    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}/channels/progress${qs}`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const bridge_read_events = createBridgeHandler({
  schema: bridgeReadChannelInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const qs = parsed.since_sequence !== undefined ? `?since_sequence=${parsed.since_sequence}` : '';
    const res = await bridgeFetch(`${bridgeUrl}/sessions/${parsed.bridge_session_id}/channels/events${qs}`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const bridge_all_events = createBridgeHandler({
  schema: bridgeAllEventsInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const params = new URLSearchParams();
    if (parsed.since_sequence !== undefined) params.set('since_sequence', String(parsed.since_sequence));
    if (parsed.filter_type) params.set('filter_type', parsed.filter_type);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await bridgeFetch(`${bridgeUrl}/channels/events${qs}`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Strategy tools (also bridge proxies)
// ---------------------------------------------------------------------------

const strategy_execute = createBridgeHandler({
  schema: strategyExecuteInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const body: Record<string, unknown> = {};
    if (parsed.strategy_yaml) body.strategy_yaml = parsed.strategy_yaml;
    if (parsed.strategy_path) body.strategy_path = parsed.strategy_path;
    if (parsed.context_inputs) body.context_inputs = parsed.context_inputs;

    const res = await bridgeFetch(`${bridgeUrl}/strategies/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { execution_id: string; status: string };
    return ok(JSON.stringify({
      execution_id: data.execution_id,
      status: data.status,
      message: `Strategy execution started. Use strategy_status with execution_id to track progress.`,
    }, null, 2));
  },
});

const strategy_status = createBridgeHandler({
  schema: strategyStatusInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/strategies/${encodeURIComponent(parsed.execution_id)}/status`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const strategy_create = createBridgeHandler({
  schema: strategyCreateInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/strategies/definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: parsed.id, yaml: parsed.yaml }),
    });
    const data = await res.json() as { id: string; file_path: string; created: boolean };
    return ok(JSON.stringify({
      id: data.id,
      file_path: data.file_path,
      message: `Strategy '${data.id}' created successfully.`,
    }, null, 2));
  },
});

const strategy_update = createBridgeHandler({
  schema: strategyUpdateInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/strategies/definitions/${encodeURIComponent(parsed.strategy_id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: parsed.yaml }),
    });
    const data = await res.json() as { id: string; file_path: string; updated: boolean };
    return ok(JSON.stringify({
      id: data.id,
      file_path: data.file_path,
      message: `Strategy '${data.id}' updated successfully.`,
    }, null, 2));
  },
});

const strategy_delete = createBridgeHandler({
  schema: strategyDeleteInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/strategies/definitions/${encodeURIComponent(parsed.strategy_id)}`, {
      method: 'DELETE',
    });
    const data = await res.json() as { id: string; deleted: boolean };
    return ok(JSON.stringify({
      id: data.id,
      deleted: data.deleted,
      message: `Strategy '${data.id}' deleted successfully.`,
    }, null, 2));
  },
});

const strategy_reload = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/strategies/reload`, {
      method: 'POST',
    });
    const data = await res.json() as { reloaded: boolean; definition_count: number };
    return ok(JSON.stringify({
      reloaded: data.reloaded,
      definition_count: data.definition_count,
      message: `Strategies reloaded. ${data.definition_count} definitions found.`,
    }, null, 2));
  },
});

const strategy_execution_status = createBridgeHandler({
  schema: strategyExecutionStatusInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/strategies/${encodeURIComponent(parsed.execution_id)}/status`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const strategy_resume = createBridgeHandler({
  schema: strategyResumeInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const body: Record<string, unknown> = {};
    if (parsed.modified_inputs) body.modified_inputs = parsed.modified_inputs;

    const res = await bridgeFetch(`${bridgeUrl}/strategies/${encodeURIComponent(parsed.execution_id)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return ok(JSON.stringify({
      ...data,
      message: `Strategy execution ${parsed.execution_id} resumed.`,
    }, null, 2));
  },
});

const strategy_abort = createBridgeHandler({
  schema: strategyAbortInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const body: Record<string, unknown> = {};
    if (parsed.reason) body.reason = parsed.reason;

    const res = await bridgeFetch(`${bridgeUrl}/strategies/${encodeURIComponent(parsed.execution_id)}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return ok(JSON.stringify({
      ...data,
      message: `Strategy execution ${parsed.execution_id} aborted.`,
    }, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Trigger tools (also bridge proxies)
// ---------------------------------------------------------------------------

const trigger_list = createBridgeHandler({
  schema: triggerListInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const params = new URLSearchParams();
    if (parsed.strategy_id) params.set('strategy_id', parsed.strategy_id);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await bridgeFetch(`${bridgeUrl}/triggers${qs}`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const trigger_enable = createBridgeHandler({
  schema: triggerIdInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/triggers/${encodeURIComponent(parsed.trigger_id)}/enable`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const trigger_disable = createBridgeHandler({
  schema: triggerIdInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/triggers/${encodeURIComponent(parsed.trigger_id)}/disable`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const trigger_pause_all = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/triggers/pause`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const trigger_resume_all = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/triggers/resume`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const trigger_reload = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/triggers/reload`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Resource copier tools (also bridge proxies)
// ---------------------------------------------------------------------------

const resource_copy_methodology = createBridgeHandler({
  schema: resourceCopyMethodologyInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/resources/copy-methodology`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: parsed.source_id, method_name: parsed.method_name, target_ids: parsed.target_ids }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const resource_copy_strategy = createBridgeHandler({
  schema: resourceCopyStrategyInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/resources/copy-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: parsed.source_id, strategy_name: parsed.strategy_name, target_ids: parsed.target_ids }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Genesis / project tools (also bridge proxies)
// ---------------------------------------------------------------------------

const project_list = createBridgeHandler({
  schema: z.object({}),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/genesis/projects/list`, {
      method: 'GET',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const project_get = createBridgeHandler({
  schema: projectIdInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/genesis/projects/${encodeURIComponent(parsed.project_id)}`, {
      method: 'GET',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const project_get_manifest = createBridgeHandler({
  schema: projectIdInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/genesis/projects/${encodeURIComponent(parsed.project_id)}/manifest`, {
      method: 'GET',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const project_read_events = createBridgeHandler({
  schema: projectReadEventsInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    // F-N-11: Validate cursor string format
    if (parsed.since_cursor && !/^[a-zA-Z0-9_-]{40,256}$/.test(parsed.since_cursor)) {
      return err(`Error: invalid cursor format. Cursor must match pattern ^[a-zA-Z0-9_-]{40,256}$. Received: ${parsed.since_cursor.slice(0, 50)}...`);
    }

    const params = new URLSearchParams();
    if (parsed.project_id) params.set('project_id', parsed.project_id);
    if (parsed.since_cursor) params.set('since_cursor', parsed.since_cursor);

    const url = `${bridgeUrl}/api/genesis/projects/events?${params.toString()}`;
    const res = await bridgeFetch(url, { method: 'GET' });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const genesis_report = createBridgeHandler({
  schema: genesisReportInput,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/genesis/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: parsed.message }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Methodology proxy tools (bridge HTTP passthrough)
// ---------------------------------------------------------------------------

const methodology_list = createBridgeHandler({
  schema: z.object({ session_id: z.string().optional() }),
  handler: async (_parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/list`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_load = createBridgeHandler({
  schema: z.object({
    methodology_id: z.string(),
    method_id: z.string(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        methodology_id: parsed.methodology_id,
        method_id: parsed.method_id,
        session_id: parsed.session_id ?? '__default__',
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_status = createBridgeHandler({
  schema: z.object({ session_id: z.string().optional() }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/status`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const step_current = createBridgeHandler({
  schema: z.object({ session_id: z.string().optional() }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/step/current`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const step_advance = createBridgeHandler({
  schema: z.object({ session_id: z.string().optional() }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/step/advance`, {
      method: 'POST',
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const step_context = createBridgeHandler({
  schema: z.object({ session_id: z.string().optional() }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/step/context`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const step_validate = createBridgeHandler({
  schema: z.object({
    step_id: z.string(),
    output: z.record(z.string(), z.unknown()),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/step/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_id: parsed.step_id,
        output: parsed.output,
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_get_routing = createBridgeHandler({
  schema: z.object({
    methodology_id: z.string(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const mid = encodeURIComponent(parsed.methodology_id);
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/${mid}/routing`);
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_start = createBridgeHandler({
  schema: z.object({
    methodology_id: z.string(),
    challenge: z.string().optional(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        methodology_id: parsed.methodology_id,
        challenge: parsed.challenge ?? null,
        session_id: parsed.session_id ?? '__default__',
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_route = createBridgeHandler({
  schema: z.object({
    challenge_predicates: z.record(z.string(), z.boolean()).optional(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_predicates: parsed.challenge_predicates ?? {},
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_select = createBridgeHandler({
  schema: z.object({
    methodology_id: z.string(),
    selected_method_id: z.string(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        methodology_id: parsed.methodology_id,
        selected_method_id: parsed.selected_method_id,
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_load_method = createBridgeHandler({
  schema: z.object({
    method_id: z.string(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/load-method`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method_id: parsed.method_id,
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

const methodology_transition = createBridgeHandler({
  schema: z.object({
    completion_summary: z.string().optional(),
    challenge_predicates: z.record(z.string(), z.boolean()).optional(),
    session_id: z.string().optional(),
  }),
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const sid = encodeURIComponent(parsed.session_id ?? '__default__');
    const res = await bridgeFetch(`${bridgeUrl}/api/methodology/sessions/${sid}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_summary: parsed.completion_summary ?? null,
        challenge_predicates: parsed.challenge_predicates ?? {},
      }),
    });
    const data = await res.json();
    return ok(JSON.stringify(data, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Exported handler map — keyed by tool name
// ---------------------------------------------------------------------------

export const bridgeHandlers: Record<
  string,
  (args: Record<string, unknown>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult>
> = {
  bridge_spawn,
  bridge_spawn_batch,
  bridge_prompt,
  bridge_kill,
  bridge_list,
  bridge_progress,
  bridge_event,
  bridge_read_progress,
  bridge_read_events,
  bridge_all_events,
  strategy_execute,
  strategy_status,
  strategy_create,
  strategy_update,
  strategy_delete,
  strategy_reload,
  strategy_execution_status,
  strategy_resume,
  strategy_abort,
  trigger_list,
  trigger_enable,
  trigger_disable,
  trigger_pause_all,
  trigger_resume_all,
  trigger_reload,
  resource_copy_methodology,
  resource_copy_strategy,
  project_list,
  project_get,
  project_get_manifest,
  project_read_events,
  genesis_report,
  // Methodology proxy tools
  methodology_list,
  methodology_load,
  methodology_status,
  step_current,
  step_advance,
  step_context,
  step_validate,
  methodology_get_routing,
  methodology_start,
  methodology_route,
  methodology_select,
  methodology_load_method,
  methodology_transition,
};
