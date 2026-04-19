// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge-side Fastify wrapper for the runtime cost-governor.
 *
 * PRD-057 / S2 §3.5 / C4: the `createCostGovernor` factory in
 * `@methodts/runtime/cost-governor` no longer owns route registration —
 * that's a transport concern that stays in bridge. This module consumes
 * the runtime primitives (`oracle`, `rateGovernor`, `observations`) and
 * wires them to Fastify. HTTP API is unchanged (PRD 051).
 */

import type { FastifyInstance } from 'fastify';
import type { InvocationSignature } from '@methodts/types';
import type {
  CostGovernor,
  HistogramCostOracle,
  SingleAccountRateGovernor,
} from '@methodts/runtime/cost-governor';
import { buildSignature } from '@methodts/runtime/cost-governor';
import type { HistoricalObservations } from '@methodts/runtime/ports';

export interface CostGovernorRouteContext {
  oracle: HistogramCostOracle;
  rateGovernor: SingleAccountRateGovernor;
  observations: HistoricalObservations;
}

/**
 * Register the `/api/cost-governor/*` routes on a Fastify instance.
 * Accepts either the flat context shape (legacy call-site) or a
 * `CostGovernor` value produced by `createCostGovernor` — both resolve
 * to the same primitives.
 */
export function registerCostGovernorRoutes(
  app: FastifyInstance,
  ctxOrGovernor: CostGovernorRouteContext | CostGovernor,
): void {
  const ctx: CostGovernorRouteContext = isCostGovernor(ctxOrGovernor)
    ? {
        oracle: ctxOrGovernor.oracle,
        rateGovernor: ctxOrGovernor.rateGovernor,
        observations: ctxOrGovernor.observations,
      }
    : ctxOrGovernor;

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

function isCostGovernor(
  value: CostGovernorRouteContext | CostGovernor,
): value is CostGovernor {
  return 'appendToken' in (value as CostGovernor);
}
