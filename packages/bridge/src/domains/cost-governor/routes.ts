import type { FastifyInstance } from 'fastify';
import type { InvocationSignature } from '@method/types';
import type { HistoricalObservations } from '../../ports/historical-observations.js';
import type { HistogramCostOracle } from './cost-oracle-impl.js';
import type { SingleAccountRateGovernor } from './rate-governor-impl.js';
import { buildSignature } from './signature-builder.js';

export interface CostGovernorRouteContext {
  oracle: HistogramCostOracle;
  rateGovernor: SingleAccountRateGovernor;
  observations: HistoricalObservations;
}

export function registerCostGovernorRoutes(
  app: FastifyInstance,
  ctx: CostGovernorRouteContext,
): void {
  /** Query estimate for a single signature. */
  app.get<{
    Querystring: {
      methodologyId: string;
      capabilities?: string;
      model: string;
      promptCharCount?: string;
    };
  }>('/api/cost-governor/estimate', async (request, reply) => {
    const { methodologyId, capabilities = '', model, promptCharCount = '0' } = request.query;
    const sig = buildSignature({
      methodologyId,
      capabilities: capabilities ? capabilities.split(',') : [],
      model,
      promptCharCount: parseInt(promptCharCount, 10) || 0,
    });
    const single = new Map([['node-1', sig]]);
    const edges = new Map([['node-1', []]]);
    const estimate = ctx.oracle.estimateStrategy(single, edges);
    return reply.status(200).send(estimate);
  });

  /** Query history of observations for a signature. */
  app.get<{
    Querystring: {
      methodologyId: string;
      capabilities?: string;
      model: string;
      inputSizeBucket?: string;
      limit?: string;
    };
  }>('/api/cost-governor/history', async (request, reply) => {
    const { methodologyId, capabilities = '', model, inputSizeBucket = 's', limit } = request.query;
    const sig: InvocationSignature = {
      methodologyId,
      capabilities: capabilities ? capabilities.split(',').sort() : [],
      model,
      inputSizeBucket: inputSizeBucket as InvocationSignature['inputSizeBucket'],
    };
    const records = ctx.observations.query(sig, limit ? parseInt(limit, 10) : undefined);
    return reply.status(200).send({ count: records.length, observations: records });
  });

  /** Current rate-governor utilization. */
  app.get('/api/cost-governor/utilization', async (_request, reply) => {
    const util = ctx.rateGovernor.utilization('claude-cli');
    const active = ctx.rateGovernor.activeSlots();
    return reply.status(200).send({ accounts: util, activeSlots: active.length });
  });

  /** Full-strategy dry-run estimate. */
  app.post<{
    Body: {
      nodes: Array<{ nodeId: string; signature: InvocationSignature }>;
      edges: Array<{ nodeId: string; dependsOn: string[] }>;
    };
  }>('/api/cost-governor/dry-run', async (request, reply) => {
    const { nodes, edges } = request.body;
    const signatures = new Map(nodes.map(n => [n.nodeId, n.signature]));
    const dagEdges = new Map(edges.map(e => [e.nodeId, e.dependsOn]));
    const estimate = ctx.oracle.estimateStrategy(signatures, dagEdges);
    return reply.status(200).send(estimate);
  });
}
