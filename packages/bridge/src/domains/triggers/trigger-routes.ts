/**
 * PRD 018: Event Triggers — HTTP Trigger Management API + Webhook Routes (Phase 2a-3)
 * PRD 019.4: Extended with trigger_config derived fields, single-trigger detail,
 *            and webhook request log endpoint.
 *
 * Registers Fastify routes for:
 *   1. Trigger management endpoints (GET /triggers, POST /triggers/:id/enable, etc.)
 *   2. Dynamic webhook routes per registered WebhookTrigger
 *   3. Webhook request log endpoint (GET /triggers/:id/webhook-log)
 *
 * Component 6 (HTTP API) and Component 3 (WebhookTrigger route binding).
 * Management endpoints follow the existing bridge auth model (localhost-only assumed).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TriggerRouter } from './trigger-router.js';
import { WebhookTrigger } from './webhook-trigger.js';
import type { TriggerConfig, TriggerRegistration } from './types.js';

/**
 * Restrict a management endpoint to localhost-only access.
 * Returns false (and sends 403) if the request is from a non-local IP.
 */
function requireLocalhost(request: FastifyRequest, reply: FastifyReply): boolean {
  const ip = request.ip;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    reply.status(403).send({ error: 'Only allowed from localhost' });
    return false;
  }
  return true;
}

const TRIGGERS_STRATEGY_DIR = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';

/**
 * PRD 019.4: Build derived config fields for a trigger registration.
 * These are type-specific fields surfaced at the top level of each trigger
 * in the API response so the frontend does not need to switch on trigger type
 * to extract common display fields.
 */
function buildDerivedConfig(config: TriggerConfig): Record<string, unknown> {
  const derived: Record<string, unknown> = {};

  switch (config.type) {
    case 'git_commit':
      derived.branch_pattern = config.branch_pattern ?? null;
      derived.path_pattern = config.path_pattern ?? null;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;

    case 'file_watch':
      derived.paths = config.paths;
      derived.events = config.events ?? null;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;

    case 'schedule':
      derived.cron = config.cron;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;

    case 'webhook':
      derived.webhook_path = config.path;
      derived.methods = config.methods ?? ['POST'];
      derived.hmac_configured = !!config.secret_env;
      derived.filter_expression = config.filter ?? null;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;

    case 'pty_watcher':
      derived.pattern = config.pattern;
      derived.condition = config.condition ?? null;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;

    case 'channel_event':
      derived.event_types = config.event_types;
      derived.filter_expression = config.filter ?? null;
      derived.debounce_ms = config.debounce_ms ?? null;
      derived.debounce_strategy = config.debounce_strategy ?? null;
      derived.max_batch_size = config.max_batch_size ?? null;
      break;
  }

  return derived;
}

/**
 * PRD 019.4: Format a single trigger registration for API response.
 * Includes the raw trigger_config and derived top-level fields.
 */
function formatTriggerResponse(t: TriggerRegistration): Record<string, unknown> {
  return {
    trigger_id: t.trigger_id,
    strategy_id: t.strategy_id,
    strategy_path: t.strategy_path,
    type: t.trigger_config.type,
    enabled: t.enabled,
    max_concurrent: t.max_concurrent,
    active_executions: t.active_executions,
    stats: t.stats,
    trigger_config: t.trigger_config,
    ...buildDerivedConfig(t.trigger_config),
  };
}

/**
 * Register all trigger management and webhook routes on the Fastify app.
 */
export function registerTriggerRoutes(
  app: FastifyInstance,
  router: TriggerRouter,
  strategyDir?: string,
): void {
  const dir = strategyDir ?? TRIGGERS_STRATEGY_DIR;

  // ── GET /triggers — List all registered triggers with status and stats ──
  // PRD 019.4: Extended to return trigger_config + derived fields for the frontend UI

  app.get<{
    Querystring: { strategy_id?: string };
  }>('/triggers', async (request, reply) => {
    const { strategy_id } = request.query;
    let triggers = router.getStatus();

    if (strategy_id) {
      triggers = triggers.filter((t) => t.strategy_id === strategy_id);
    }

    return reply.status(200).send({
      triggers: triggers.map(formatTriggerResponse),
      paused: router.isPaused,
      total: triggers.length,
      watcher_count: router.watcherCount,
    });
  });

  // ── GET /triggers/history — Global trigger fire history ──
  // PRD 019.4: Extended with trigger_id query param for per-trigger filtering

  app.get<{
    Querystring: { limit?: string; trigger_id?: string };
  }>('/triggers/history', async (request, reply) => {
    // Filter by trigger_id first, then apply limit (F-4: filter before slice)
    let history = router.getHistory();

    if (request.query.trigger_id) {
      history = history.filter((e) => e.trigger_id === request.query.trigger_id);
    }

    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    if (limit !== undefined) {
      history = history.slice(-limit);
    }

    return reply.status(200).send({
      events: history,
      count: history.length,
    });
  });

  // ── GET /triggers/:id — Single trigger detail ──
  // PRD 019.4: Full detail for trigger slide-over and deep links, includes
  // derived config fields and recent fires (last 10)

  app.get<{
    Params: { id: string };
  }>('/triggers/:id', async (request, reply) => {
    const { id } = request.params;

    // Find the trigger in registrations
    const triggers = router.getStatus();
    const trigger = triggers.find((t) => t.trigger_id === id);

    if (!trigger) {
      return reply.status(404).send({ error: `Trigger not found: ${id}` });
    }

    // Get recent fires for this trigger (last 10, newest last)
    const allHistory = router.getHistory();
    const recentFires = allHistory
      .filter((e) => e.trigger_id === id)
      .slice(-10);

    return reply.status(200).send({
      ...formatTriggerResponse(trigger),
      recent_fires: recentFires,
    });
  });

  // ── GET /triggers/:id/webhook-log — Recent webhook requests ──
  // PRD 019.4: Returns the ring buffer of recent webhook requests for
  // a specific webhook trigger. Only valid for webhook-type triggers.

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/triggers/:id/webhook-log', async (request, reply) => {
    const { id } = request.params;

    // Find the trigger in registrations
    const triggers = router.getStatus();
    const trigger = triggers.find((t) => t.trigger_id === id);

    if (!trigger) {
      return reply.status(404).send({ error: `Trigger not found: ${id}` });
    }

    if (trigger.trigger_config.type !== 'webhook') {
      return reply.status(400).send({
        error: `Trigger ${id} is type '${trigger.trigger_config.type}', not 'webhook'. Webhook log is only available for webhook triggers.`,
      });
    }

    // Resolve the live WebhookTrigger instance from the router to access its ring buffer
    const webhooks = router.getWebhookTriggers();
    const match = webhooks.find((w) => w.triggerId === id);

    if (!match) {
      // Trigger exists in registrations but has no active watcher (e.g., disabled)
      return reply.status(200).send({
        trigger_id: id,
        requests: [],
        count: 0,
      });
    }

    // Parse and clamp limit: default 20, max 50
    const rawLimit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 50);

    const requests = match.watcher.getRequestLog(limit);

    return reply.status(200).send({
      trigger_id: id,
      requests,
      count: requests.length,
    });
  });

  // ── POST /triggers/:id/enable — Enable a specific trigger ──

  app.post<{
    Params: { id: string };
  }>('/triggers/:id/enable', async (request, reply) => {
    if (!requireLocalhost(request, reply)) return;
    const { id } = request.params;

    try {
      router.setTriggerEnabled(id, true);
      return reply.status(200).send({
        trigger_id: id,
        enabled: true,
        message: `Trigger ${id} enabled`,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /triggers/:id/disable — Disable a specific trigger ──

  app.post<{
    Params: { id: string };
  }>('/triggers/:id/disable', async (request, reply) => {
    if (!requireLocalhost(request, reply)) return;
    const { id } = request.params;

    try {
      router.setTriggerEnabled(id, false);
      return reply.status(200).send({
        trigger_id: id,
        enabled: false,
        message: `Trigger ${id} disabled`,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /triggers/pause — Pause all triggers (maintenance mode) ──

  app.post('/triggers/pause', async (request, reply) => {
    if (!requireLocalhost(request, reply)) return;
    router.pauseAll();
    return reply.status(200).send({
      paused: true,
      message: 'All triggers paused',
    });
  });

  // ── POST /triggers/resume — Resume all triggers ──

  app.post('/triggers/resume', async (request, reply) => {
    if (!requireLocalhost(request, reply)) return;
    router.resumeAll();
    return reply.status(200).send({
      paused: false,
      message: 'All triggers resumed',
    });
  });

  // ── POST /triggers/reload — Hot reload strategy registrations ──

  app.post('/triggers/reload', async (request, reply) => {
    if (!requireLocalhost(request, reply)) return;
    try {
      const result = await router.reloadStrategies(dir);

      // After reload, re-register webhook routes for any new/updated webhooks
      registerWebhookRoutes(app, router);

      return reply.status(200).send({
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        errors: result.errors,
        message: `Reload: ${result.added.length} added, ${result.updated.length} updated, ${result.removed.length} removed`,
      });
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // ── Preserve raw body for HMAC signature verification ──
  // Fastify's preParsing hook captures the raw bytes before JSON parsing,
  // ensuring HMAC is computed over the exact bytes the sender signed.
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.url.startsWith('/triggers/webhook/')) {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBuffer = Buffer.concat(chunks);
      (request as any).rawBuffer = rawBuffer;
      // Return a new readable stream from the buffer for Fastify to parse
      const { Readable } = await import('node:stream');
      return Readable.from(rawBuffer);
    }
    return payload;
  });

  // ── Register webhook routes for existing triggers ──
  registerWebhookRoutes(app, router);
}

// Track which webhook paths have been registered to avoid duplicates.
// NOTE: Module-scoped singleton — Fastify does not support route removal, so
// webhook paths are permanent once registered. The handler dynamically resolves
// the trigger via router.getWebhookTriggers(), so deleted triggers return 404.
// Tests that import this module share the same set; use caution in test isolation.
const registeredWebhookPaths = new Set<string>();

/**
 * Register Fastify routes for each active WebhookTrigger.
 * Dynamically creates POST (or custom method) routes at the webhook's configured path.
 * Skips paths that are already registered.
 *
 * NOTE: Fastify does not support route removal, so webhook paths are permanent
 * once registered. The handler dynamically resolves the trigger via
 * router.getWebhookTriggers(), so deleted triggers return 404 at runtime.
 */
function registerWebhookRoutes(
  app: FastifyInstance,
  router: TriggerRouter,
): void {
  const webhooks = router.getWebhookTriggers();

  for (const { triggerId, watcher } of webhooks) {
    const routePath = watcher.path;

    // Skip if already registered
    if (registeredWebhookPaths.has(routePath)) continue;
    registeredWebhookPaths.add(routePath);

    // Register route for each allowed method
    for (const method of watcher.methods) {
      const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';

      app.route({
        method: httpMethod.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        url: routePath,
        config: {
          // Fastify config for raw body access
          rawBody: true,
        },
        handler: async (request, reply) => {
          // Find the current webhook trigger for this path (may change after reload)
          const currentWebhooks = router.getWebhookTriggers();
          const current = currentWebhooks.find((w) => w.watcher.path === routePath);

          if (!current) {
            return reply.status(404).send({ error: 'Webhook trigger not found for this path' });
          }

          // Use the raw buffer captured by preParsing hook for HMAC validation.
          // Falls back to JSON.stringify if the hook didn't run (defensive).
          const rawBuffer: Buffer = (request as any).rawBuffer
            ?? Buffer.from(typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body ?? ''));

          const headers = request.headers as Record<string, string | string[] | undefined>;

          const result = current.watcher.handleWebhook(
            request.body,
            rawBuffer,
            headers,
            request.method,
          );

          return reply.status(result.status).send(result.body);
        },
      });
    }
  }
}
