/**
 * PRD 018: Event Triggers — HTTP Trigger Management API + Webhook Routes (Phase 2a-3)
 *
 * Registers Fastify routes for:
 *   1. Trigger management endpoints (GET /triggers, POST /triggers/:id/enable, etc.)
 *   2. Dynamic webhook routes per registered WebhookTrigger
 *
 * Component 6 (HTTP API) and Component 3 (WebhookTrigger route binding).
 * Management endpoints follow the existing bridge auth model (localhost-only assumed).
 */

import type { FastifyInstance } from 'fastify';
import { TriggerRouter } from './trigger-router.js';
import { WebhookTrigger } from './webhook-trigger.js';

const TRIGGERS_STRATEGY_DIR = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';

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

  app.get<{
    Querystring: { strategy_id?: string };
  }>('/triggers', async (request, reply) => {
    const { strategy_id } = request.query;
    let triggers = router.getStatus();

    if (strategy_id) {
      triggers = triggers.filter((t) => t.strategy_id === strategy_id);
    }

    return reply.status(200).send({
      triggers: triggers.map((t) => ({
        trigger_id: t.trigger_id,
        strategy_id: t.strategy_id,
        strategy_path: t.strategy_path,
        type: t.trigger_config.type,
        enabled: t.enabled,
        max_concurrent: t.max_concurrent,
        active_executions: t.active_executions,
        stats: t.stats,
      })),
      paused: router.isPaused,
      total: triggers.length,
      watcher_count: router.watcherCount,
    });
  });

  // ── GET /triggers/history — Global trigger fire history ──

  app.get<{
    Querystring: { limit?: string };
  }>('/triggers/history', async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    const history = router.getHistory(limit);

    return reply.status(200).send({
      events: history,
      count: history.length,
    });
  });

  // ── POST /triggers/:id/enable — Enable a specific trigger ──

  app.post<{
    Params: { id: string };
  }>('/triggers/:id/enable', async (request, reply) => {
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

  app.post('/triggers/pause', async (_request, reply) => {
    router.pauseAll();
    return reply.status(200).send({
      paused: true,
      message: 'All triggers paused',
    });
  });

  // ── POST /triggers/resume — Resume all triggers ──

  app.post('/triggers/resume', async (_request, reply) => {
    router.resumeAll();
    return reply.status(200).send({
      paused: false,
      message: 'All triggers resumed',
    });
  });

  // ── POST /triggers/reload — Hot reload strategy registrations ──

  app.post('/triggers/reload', async (_request, reply) => {
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

  // ── Register webhook routes for existing triggers ──
  registerWebhookRoutes(app, router);
}

// Track which webhook paths have been registered to avoid duplicates
const registeredWebhookPaths = new Set<string>();

/**
 * Register Fastify routes for each active WebhookTrigger.
 * Dynamically creates POST (or custom method) routes at the webhook's configured path.
 * Skips paths that are already registered.
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

          // Get raw body string for HMAC validation
          const rawBody = typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body ?? '');

          const headers = request.headers as Record<string, string | string[] | undefined>;

          const result = current.watcher.handleWebhook(
            request.body,
            rawBody,
            headers,
          );

          return reply.status(result.status).send(result.body);
        },
      });
    }
  }
}
