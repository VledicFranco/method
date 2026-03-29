/**
 * Session domain HTTP routes — CRUD, channels, event aggregation, shutdown.
 *
 * Endpoints:
 *   POST   /sessions              — Spawn a new agent session
 *   POST   /sessions/batch        — Spawn multiple sessions with stagger (PRD 012)
 *   POST   /sessions/:id/prompt   — Send prompt, wait for response
 *   GET    /sessions/:id/status   — Session status + queue depth
 *   DELETE /sessions/:id          — Kill a session
 *   GET    /sessions              — List all sessions
 *   POST   /sessions/:id/channels/progress — Agent reports progress (PRD 008)
 *   POST   /sessions/:id/channels/events   — Agent reports lifecycle events (PRD 008)
 *   GET    /sessions/:id/channels/progress — Parent reads child progress
 *   GET    /sessions/:id/channels/events   — Parent reads child events
 *   GET    /channels/events       — Cross-session event aggregation
 *   POST   /shutdown              — Graceful shutdown (localhost only)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionPool } from './pool.js';
import { readMessages, type ChannelMessage, type SessionChannels } from './channels.js';
import type { ChannelSink } from '../../shared/event-bus/channel-sink.js';
import type { EventBus } from '../../ports/event-bus.js';
import { lintGlyphBlocks, buildRepairPrompt, patchResponse } from './glyph-lint.js';

export interface SessionRouteDeps {
  pool: SessionPool;
  tokenTracker: { registerSession(id: string, workdir: string, date: Date): void; refreshUsage(id: string): unknown };
  writePidFile: () => void;
  batchStaggerMs: number;
  triggerChannels: SessionChannels;
  gracefulShutdown: (signal: string) => void;
  /** PRD 026 Phase 3: ChannelSink for reading events from bus. */
  channelSink?: ChannelSink;
  /** PRD 026 Phase 3: EventBus for POST channel endpoints. */
  eventBus?: EventBus;
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const { pool, tokenTracker, writePidFile, batchStaggerMs, triggerChannels, gracefulShutdown, channelSink, eventBus } = deps;

  // ── POST /sessions — Spawn a new session ──

  app.post<{
    Body: {
      workdir: string;
      initial_prompt?: string;
      spawn_args?: string[];
      metadata?: Record<string, unknown>;
      parent_session_id?: string;
      depth?: number;
      budget?: { max_depth?: number; max_agents?: number; agents_spawned?: number };
      isolation?: 'worktree' | 'shared';
      timeout_ms?: number;
      nickname?: string;
      purpose?: string;
      spawn_delay_ms?: number;
      mode?: 'pty' | 'print';
      allowed_paths?: string[];
      scope_mode?: 'enforce' | 'warn';
      /** PRD 033: Provider type — 'print' (default) or 'cognitive-agent'. */
      provider_type?: 'print' | 'cognitive-agent';
      /** PRD 033: Cognitive session configuration overrides. */
      cognitive_config?: {
        name?: string;
        maxCycles?: number;
        workspaceCapacity?: number;
        confidenceThreshold?: number;
        stagnationThreshold?: number;
        interventionBudget?: number;
      };
      /** PRD 033: Cognitive pattern flags (e.g. ['P5', 'P6']). */
      cognitive_patterns?: string[];
    };
  }>('/sessions', async (request, reply) => {
    const { workdir, initial_prompt, spawn_args, metadata, parent_session_id, depth, budget, isolation, timeout_ms, nickname, purpose, spawn_delay_ms, mode, allowed_paths, scope_mode, provider_type, cognitive_config, cognitive_patterns } = request.body ?? {};

    if (!workdir || typeof workdir !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: workdir' });
    }

    // PRD 028: PTY mode removed — mode field is ignored, always print
    if (mode === 'pty') {
      request.log.warn('[PRD028] mode=pty is no longer supported. Session runs in print mode.');
    }

    // Validate cognitive_config if provided
    if (cognitive_config) {
      const cognitiveConfigSchema = z.object({
        name: z.string().optional(),
        maxCycles: z.number().int().min(1).max(100).optional(),
        workspaceCapacity: z.number().int().min(1).max(64).optional(),
        confidenceThreshold: z.number().min(0).max(1).optional(),
        stagnationThreshold: z.number().int().min(1).max(10).optional(),
        interventionBudget: z.number().int().min(0).max(20).optional(),
      });
      const parsed = cognitiveConfigSchema.safeParse(cognitive_config);
      if (!parsed.success) {
        return reply.status(400).send({ error: `Invalid cognitive_config: ${parsed.error.message}` });
      }
    }

    try {
      const result = await pool.create({
        workdir,
        initialPrompt: initial_prompt,
        spawnArgs: spawn_args,
        metadata,
        parentSessionId: parent_session_id,
        depth,
        budget,
        isolation,
        timeout_ms,
        nickname,
        purpose,
        spawn_delay_ms,
        allowed_paths,
        scope_mode,
        provider_type,
        cognitive_config,
        cognitive_patterns,
      });

      tokenTracker.registerSession(result.sessionId, workdir, new Date());
      writePidFile();

      app.log.info(`[${result.nickname}] Session spawned`);

      return reply.status(201).send({
        session_id: result.sessionId,
        nickname: result.nickname,
        status: result.status,
        mode: result.mode,
        depth: result.chain.depth,
        parent_session_id: result.chain.parent_session_id,
        budget: result.chain.budget,
        isolation: result.worktree.isolation,
        worktree_path: result.worktree.worktree_path,
        metals_available: result.worktree.metals_available,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('pool full')) {
        return reply.status(503).send({ error: message });
      }
      try {
        const parsed = JSON.parse(message);
        if (parsed.error === 'DEPTH_EXCEEDED' || parsed.error === 'BUDGET_EXHAUSTED') {
          return reply.status(409).send(parsed);
        }
      } catch { /* not JSON, fall through */ }
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /sessions/batch — Spawn multiple sessions (PRD 012) ──

  app.post<{
    Body: {
      sessions: Array<{
        workdir: string;
        initial_prompt?: string;
        spawn_args?: string[];
        metadata?: Record<string, unknown>;
        parent_session_id?: string;
        depth?: number;
        budget?: { max_depth?: number; max_agents?: number; agents_spawned?: number };
        isolation?: 'worktree' | 'shared';
        timeout_ms?: number;
        nickname?: string;
        purpose?: string;
        mode?: 'pty' | 'print';
        allowed_paths?: string[];
        scope_mode?: 'enforce' | 'warn';
      }>;
      stagger_ms?: number;
    };
  }>('/sessions/batch', async (request, reply) => {
    const { sessions: sessionConfigs, stagger_ms } = request.body ?? {};

    if (!Array.isArray(sessionConfigs) || sessionConfigs.length === 0) {
      return reply.status(400).send({ error: 'Missing required field: sessions (non-empty array)' });
    }

    const stagger = stagger_ms ?? batchStaggerMs;
    const results: Array<{
      session_id: string;
      nickname: string;
      status: string;
      mode: string;
      depth: number;
      parent_session_id: string | null;
      budget: { max_depth: number; max_agents: number; agents_spawned: number };
      isolation: string;
      worktree_path: string | null;
      metals_available: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < sessionConfigs.length; i++) {
      const cfg = sessionConfigs[i];

      if (i > 0 && stagger > 0) {
        await new Promise(r => setTimeout(r, stagger));
      }

      if (!cfg.workdir || typeof cfg.workdir !== 'string') {
        results.push({
          session_id: '',
          nickname: '',
          status: 'error',
          mode: 'print',
          depth: 0,
          parent_session_id: null,
          budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
          isolation: 'shared',
          worktree_path: null,
          metals_available: true,
          error: `Session ${i}: missing required field: workdir`,
        });
        continue;
      }

      try {
        const result = await pool.create({
          workdir: cfg.workdir,
          initialPrompt: cfg.initial_prompt,
          spawnArgs: cfg.spawn_args,
          metadata: cfg.metadata,
          parentSessionId: cfg.parent_session_id,
          depth: cfg.depth,
          budget: cfg.budget,
          isolation: cfg.isolation,
          timeout_ms: cfg.timeout_ms,
          nickname: cfg.nickname,
          purpose: cfg.purpose,
          // PRD 028: mode field ignored — always print
          allowed_paths: cfg.allowed_paths,
          scope_mode: cfg.scope_mode,
        });

        tokenTracker.registerSession(result.sessionId, cfg.workdir, new Date());
        app.log.info(`[batch ${i}/${sessionConfigs.length}] [${result.nickname}] Session spawned (${result.mode})`);

        results.push({
          session_id: result.sessionId,
          nickname: result.nickname,
          status: result.status,
          mode: result.mode,
          depth: result.chain.depth,
          parent_session_id: result.chain.parent_session_id,
          budget: result.chain.budget,
          isolation: result.worktree.isolation,
          worktree_path: result.worktree.worktree_path,
          metals_available: result.worktree.metals_available,
        });
      } catch (e) {
        const message = (e as Error).message;
        app.log.error(`[batch ${i}/${sessionConfigs.length}] Spawn failed: ${message}`);
        results.push({
          session_id: '',
          nickname: '',
          status: 'error',
          mode: 'print',
          depth: 0,
          parent_session_id: null,
          budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
          isolation: 'shared',
          worktree_path: null,
          metals_available: true,
          error: message,
        });
      }
    }

    const spawned = results.filter(r => r.status !== 'error').length;
    const failed = results.filter(r => r.status === 'error').length;
    writePidFile();

    return reply.status(201).send({
      sessions: results,
      stagger_ms: stagger,
      spawned,
      failed,
    });
  });

  // ── POST /sessions/:id/prompt ──

  app.post<{
    Params: { id: string };
    Body: { prompt: string; timeout_ms?: number; settle_delay_ms?: number };
  }>('/sessions/:id/prompt', async (request, reply) => {
    const { id } = request.params;
    const { prompt, timeout_ms, settle_delay_ms } = request.body ?? {};

    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: prompt' });
    }

    try {
      const result = await pool.prompt(id, prompt, timeout_ms, settle_delay_ms);
      tokenTracker.refreshUsage(id);

      // Map PrintMetadata → response shape
      const metadata = result.metadata ? {
        cost_usd: result.metadata.total_cost_usd,
        num_turns: result.metadata.num_turns,
        duration_ms: result.metadata.duration_ms,
        stop_reason: result.metadata.stop_reason,
        input_tokens: result.metadata.usage.input_tokens,
        output_tokens: result.metadata.usage.output_tokens,
        cache_read_tokens: result.metadata.usage.cache_read_input_tokens,
        cache_write_tokens: result.metadata.usage.cache_creation_input_tokens,
      } : null;

      // Emit BridgeEvent if eventBus is available
      if (eventBus) {
        eventBus.emit({
          version: 1,
          domain: 'session',
          type: 'session.prompt.completed',
          severity: 'info',
          sessionId: id,
          payload: {
            output_length: result.output.length,
            timed_out: result.timedOut,
            cost_usd: metadata?.cost_usd ?? 0,
            num_turns: metadata?.num_turns ?? 0,
            duration_ms: metadata?.duration_ms ?? 0,
            stop_reason: metadata?.stop_reason ?? null,
          },
          source: 'bridge/sessions/routes',
        });
      }

      // ── GlyphJS auto-repair: lint ui: blocks, re-prompt on failure ──
      let finalOutput = result.output;
      try {
        const lint = lintGlyphBlocks(result.output);
        if (lint.failures.length > 0) {
          console.log(`[glyph-lint] ${lint.failures.length}/${lint.totalBlocks} ui: block(s) failed validation in session ${id}, attempting repair...`);
          const repairPrompt = buildRepairPrompt(lint.failures);
          const repairResult = await pool.prompt(id, repairPrompt, 120_000);
          if (!repairResult.timedOut && repairResult.output) {
            const patched = patchResponse(result.output, lint.failures, repairResult.output);
            // Verify the patch actually fixed the blocks
            const recheck = lintGlyphBlocks(patched);
            if (recheck.failures.length < lint.failures.length) {
              console.log(`[glyph-lint] Repair succeeded: ${lint.failures.length - recheck.failures.length} block(s) fixed`);
              finalOutput = patched;
            } else {
              console.log(`[glyph-lint] Repair did not improve blocks, keeping original`);
            }
          }
        }
      } catch (lintErr) {
        // Linting/repair failure is non-fatal — return original response
        console.warn(`[glyph-lint] Error during lint/repair:`, (lintErr as Error).message);
      }

      return reply.status(200).send({ output: finalOutput, timed_out: result.timedOut, metadata });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      if (message.includes('dead')) return reply.status(400).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /sessions/:id/prompt/stream — SSE streaming prompt ──

  app.post<{
    Params: { id: string };
    Body: { prompt: string; timeout_ms?: number };
  }>('/sessions/:id/prompt/stream', async (request, reply) => {
    const { id } = request.params;
    const { prompt, timeout_ms } = request.body ?? {};

    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: prompt' });
    }

    // Validate session exists before setting up SSE
    try {
      pool.status(id);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      if (message.includes('dead')) return reply.status(400).send({ error: message });
      return reply.status(500).send({ error: message });
    }

    console.log(`[stream] SSE setup for session ${id}`);

    // Hijack the response so Fastify doesn't interfere with raw SSE writes
    await reply.hijack();

    // Set SSE headers via raw response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Keep-alive heartbeat to prevent proxy/client timeouts
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(':heartbeat\n\n');
      } catch {
        // Connection may be closed
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Handle client disconnect
    let clientDisconnected = false;
    request.raw.on('close', () => {
      clientDisconnected = true;
      clearInterval(heartbeat);
    });

    function sendSSE(data: unknown): void {
      if (clientDisconnected) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Write failure — client disconnected
        clientDisconnected = true;
      }
    }

    try {
      await pool.promptStream(
        id,
        prompt,
        (event) => {
          sendSSE(event);
        },
        timeout_ms ?? 300_000,
      );
    } catch (e) {
      sendSSE({ type: 'error', error: (e as Error).message });
    } finally {
      clearInterval(heartbeat);
      // Emit bus event for completion tracking
      if (eventBus) {
        eventBus.emit({
          version: 1,
          domain: 'session',
          type: 'session.prompt.completed',
          severity: 'info',
          sessionId: id,
          payload: { streaming: true },
          source: 'bridge/sessions/routes',
        });
      }
      // End the SSE stream
      if (!clientDisconnected) {
        try { reply.raw.end(); } catch { /* non-fatal */ }
      }
    }
  });

  // ── GET /sessions/:id/status ──

  app.get<{ Params: { id: string } }>('/sessions/:id/status', async (request, reply) => {
    const { id } = request.params;
    try {
      const result = pool.status(id);
      return reply.status(200).send({
        session_id: result.sessionId,
        nickname: result.nickname,
        purpose: result.purpose,
        status: result.status,
        mode: result.mode,
        queue_depth: result.queueDepth,
        metadata: result.metadata,
        prompt_count: result.promptCount,
        last_activity_at: result.lastActivityAt.toISOString(),
        workdir: result.workdir,
        parent_session_id: result.chain.parent_session_id,
        depth: result.chain.depth,
        children: result.chain.children,
        budget: result.chain.budget,
        isolation: result.worktree.isolation,
        worktree_path: result.worktree.worktree_path,
        metals_available: result.worktree.metals_available,
        stale: result.stale,
        diagnostics: result.diagnostics,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  // ── DELETE /sessions/:id ──

  app.delete<{
    Params: { id: string };
    Body: { worktree_action?: 'merge' | 'keep' | 'discard' };
  }>('/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const { worktree_action } = request.body ?? {};
    try {
      const result = pool.kill(id, worktree_action);
      writePidFile();
      return reply.status(200).send({
        session_id: result.sessionId,
        killed: result.killed,
        worktree_cleaned: result.worktree_cleaned,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /sessions ──

  app.get('/sessions', async (_request, reply) => {
    const sessions = pool.list();
    return reply.status(200).send(
      sessions.map((s) => ({
        session_id: s.sessionId,
        nickname: s.nickname,
        purpose: s.purpose,
        status: s.status,
        mode: s.mode,
        queue_depth: s.queueDepth,
        metadata: s.metadata,
        prompt_count: s.promptCount,
        last_activity_at: s.lastActivityAt.toISOString(),
        workdir: s.workdir,
        parent_session_id: s.chain.parent_session_id,
        depth: s.chain.depth,
        children: s.chain.children,
        budget: s.chain.budget,
        isolation: s.worktree.isolation,
        worktree_path: s.worktree.worktree_path,
        metals_available: s.worktree.metals_available,
        stale: s.stale,
      })),
    );
  });

  // ── Channels (PRD 008) ──

  app.post<{
    Params: { id: string };
    Body: { type: string; content: Record<string, unknown>; sender?: string };
  }>('/sessions/:id/channels/progress', async (request, reply) => {
    const { id } = request.params;
    const { type, content, sender } = request.body ?? {};
    if (!type || typeof type !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: type' });
    }
    try {
      // PRD 026 Phase 3: Emit to bus (ChannelSink captures for reads)
      let sequence = 0;
      if (eventBus) {
        const evt = eventBus.emit({
          version: 1,
          domain: 'session',
          type: `session.channel.${type}`,
          severity: 'info',
          sessionId: id,
          payload: { channelTarget: 'progress', sender: sender ?? id, ...(content ?? {}) },
          source: 'bridge/sessions/channels',
        });
        sequence = evt.sequence;
      }
      return reply.status(201).send({ sequence, acknowledged: true });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { type: string; content: Record<string, unknown>; sender?: string };
  }>('/sessions/:id/channels/events', async (request, reply) => {
    const { id } = request.params;
    const { type, content, sender } = request.body ?? {};
    if (!type || typeof type !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: type' });
    }
    try {
      // PRD 026 Phase 3: Emit to bus (ChannelSink handles push notifications via severity)
      const PUSHABLE_EVENTS = new Set(['completed', 'error', 'escalation', 'budget_warning', 'stale', 'scope_violation']);
      const severity = PUSHABLE_EVENTS.has(type) ? 'warning' as const : 'info' as const;
      let sequence = 0;
      if (eventBus) {
        const evt = eventBus.emit({
          version: 1,
          domain: 'session',
          type: `session.channel.${type}`,
          severity,
          sessionId: id,
          payload: { channelTarget: 'events', sender: sender ?? id, ...(content ?? {}) },
          source: 'bridge/sessions/channels',
        });
        sequence = evt.sequence;
      }
      return reply.status(201).send({ sequence, acknowledged: true });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { since_sequence?: string; reader_id?: string };
  }>('/sessions/:id/channels/progress', async (request, reply) => {
    const { id } = request.params;
    const sinceSequence = parseInt(request.query.since_sequence ?? '0', 10);
    const readerId = request.query.reader_id;
    try {
      // PRD 026 Phase 3: Read from ChannelSink when available
      if (channelSink) {
        const result = channelSink.getEvents(id, sinceSequence, 'progress');
        return reply.status(200).send(result);
      }
      // Fallback to legacy channels
      const channels = pool.getChannels(id);
      const result = readMessages(channels.progress, sinceSequence, readerId);
      return reply.status(200).send(result);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { since_sequence?: string; reader_id?: string };
  }>('/sessions/:id/channels/events', async (request, reply) => {
    const { id } = request.params;
    const sinceSequence = parseInt(request.query.since_sequence ?? '0', 10);
    const readerId = request.query.reader_id;
    try {
      // PRD 026 Phase 3: Read from ChannelSink when available
      if (channelSink) {
        const result = channelSink.getEvents(id, sinceSequence, 'events');
        return reply.status(200).send(result);
      }
      // Fallback to legacy channels
      const channels = pool.getChannels(id);
      const result = readMessages(channels.events, sinceSequence, readerId);
      return reply.status(200).send(result);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /channels/events — Cross-session aggregation ──

  app.get<{
    Querystring: { since_sequence?: string; filter_type?: string };
  }>('/channels/events', async (_request, reply) => {
    const sinceSequence = parseInt(_request.query.since_sequence ?? '0', 10);
    const filterType = _request.query.filter_type;

    // PRD 026 Phase 3: Read from ChannelSink when available
    if (channelSink) {
      const result = channelSink.getAggregated(sinceSequence, filterType);
      return reply.status(200).send(result);
    }

    // Fallback to legacy channels
    const sessions = pool.list();
    const events: Array<{
      bridge_session_id: string;
      session_metadata: Record<string, unknown>;
      message: ChannelMessage;
    }> = [];

    let globalLastSequence = sinceSequence;

    for (const session of sessions) {
      try {
        const channels = pool.getChannels(session.sessionId);
        const result = readMessages(channels.events, sinceSequence);
        for (const msg of result.messages) {
          if (filterType && msg.type !== filterType) continue;
          events.push({
            bridge_session_id: session.sessionId,
            session_metadata: {
              commission_id: (session.metadata as Record<string, unknown> | undefined)?.commission_id,
              task_summary: (session.metadata as Record<string, unknown> | undefined)?.task_summary,
              methodology: (session.metadata as Record<string, unknown> | undefined)?.methodology_session_id,
            } as Record<string, unknown>,
            message: msg,
          });
          if (msg.sequence > globalLastSequence) globalLastSequence = msg.sequence;
        }
      } catch { /* session may have been cleaned up */ }
    }

    // PRD 018: Include trigger_fired events from global trigger channel
    try {
      const triggerResult = readMessages(triggerChannels.events, sinceSequence);
      for (const msg of triggerResult.messages) {
        if (filterType && msg.type !== filterType) continue;
        events.push({
          bridge_session_id: 'triggers',
          session_metadata: {
            trigger_id: (msg.content as Record<string, unknown>)?.trigger_id,
            strategy_id: (msg.content as Record<string, unknown>)?.strategy_id,
          } as Record<string, unknown>,
          message: msg,
        });
        if (msg.sequence > globalLastSequence) globalLastSequence = msg.sequence;
      }
    } catch { /* non-fatal */ }

    events.sort((a, b) => a.message.timestamp.localeCompare(b.message.timestamp));

    return reply.status(200).send({ events, last_sequence: globalLastSequence });
  });

  // ── POST /shutdown ──

  app.post('/shutdown', async (request, reply) => {
    const ip = request.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.status(403).send({ error: 'Shutdown only allowed from localhost' });
    }
    reply.status(200).send({ status: 'shutting_down' });
    setImmediate(() => gracefulShutdown('API'));
  });
}
