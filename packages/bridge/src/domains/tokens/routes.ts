import type { FastifyInstance } from 'fastify';
import type { TokenTracker } from './tracker.js';
import type { UsagePoller } from './usage-poller.js';

export function registerTokenRoutes(
  app: FastifyInstance,
  tokenTracker: TokenTracker,
  usagePoller: UsagePoller,
): void {
  app.get('/api/tokens', async (_request, reply) => {
    const aggregate = tokenTracker.getAggregate();
    return reply.status(200).send(aggregate);
  });

  app.get<{ Params: { id: string } }>('/api/tokens/:id', async (request, reply) => {
    const usage = tokenTracker.refreshUsage(request.params.id);
    if (!usage) {
      return reply.status(404).send({ error: 'Session not found or no token data' });
    }
    return reply.status(200).send(usage);
  });

  app.get('/api/usage', async (_request, reply) => {
    const status = usagePoller.getStatus();
    const cached = usagePoller.getCached();
    return reply.status(200).send({ status, usage: cached });
  });
}
