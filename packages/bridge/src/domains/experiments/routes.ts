/**
 * Experiments domain — REST routes (PRD 041 Phase 2).
 *
 * Registers the /lab/* Fastify endpoints for the Cognitive Experiment Lab
 * dashboard and MCP consumption.
 *
 * Route summary:
 *   GET /lab                             — list all experiments
 *   GET /lab/:id                         — get experiment + its runs
 *   GET /lab/:id/runs/:runId             — get run details + metrics
 *   GET /lab/:id/runs/:runId/traces      — trace events (filterable)
 *   GET /lab/:id/runs/:runId/events      — raw event array
 *
 * DR-04: Handlers are thin wrappers — parse input, call core/persistence,
 * format output. No business logic here.
 */

import type { FastifyInstance } from 'fastify';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  listRuns,
  getRun,
  captureRunConfig,
  captureEnvironment,
  createRun,
  setCorePorts,
  setDataDir,
} from './core.js';
import {
  readTraces,
  readEvents,
  setPersistencePorts,
  setPersistenceDataDir,
} from './persistence.js';
import type { TraceFilter } from './types.js';
import { CreateExperimentSchema, CreateRunSchema } from './config.js';

// ── Port injection ──────────────────────────────────────────────

let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** Configure ports for experiment routes. Called from composition root. */
export function setExperimentRoutesPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
  setCorePorts(fs, yaml);
  setPersistencePorts(fs);
}

/** Override data directory for routes (test isolation). */
export function setExperimentRoutesDataDir(dir: string): void {
  setDataDir(dir);
  setPersistenceDataDir(dir);
}

// ── Route registration ──────────────────────────────────────────

export function registerExperimentRoutes(app: FastifyInstance): void {

  /**
   * GET /lab — List all experiments.
   *
   * Returns an array of Experiment objects sorted by creation time (newest first).
   */
  app.get('/lab', async (_request, reply) => {
    try {
      const experiments = await listExperiments();
      experiments.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return reply.status(200).send(experiments);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  /**
   * POST /lab — Create a new experiment.
   *
   * Body: CreateExperimentInput (name, hypothesis, conditions, tasks)
   * Returns the created Experiment with 201.
   */
  app.post<{
    Body: {
      name?: string;
      hypothesis?: string;
      conditions?: unknown[];
      tasks?: string[];
    };
  }>('/lab', async (request, reply) => {
    const parseResult = CreateExperimentSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid experiment input',
        details: parseResult.error.issues,
      });
    }

    try {
      const experiment = await createExperiment(parseResult.data);
      return reply.status(201).send(experiment);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  /**
   * GET /lab/:id — Get experiment details plus its runs list.
   *
   * Returns { experiment, runs } or 404 if not found.
   */
  app.get<{ Params: { id: string } }>('/lab/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const [experiment, runs] = await Promise.all([
        getExperiment(id),
        listRuns(id),
      ]);
      return reply.status(200).send({ experiment, runs });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found') || msg.includes('Experiment not found')) {
        return reply.status(404).send({ error: msg });
      }
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * POST /lab/:id/runs — Create a new run.
   *
   * Body: { conditionName, task }
   * Returns the created Run with 201.
   * Enforces AC-07: experiment must exist.
   */
  app.post<{
    Params: { id: string };
    Body: { conditionName?: string; task?: string };
  }>('/lab/:id/runs', async (request, reply) => {
    const { id } = request.params;
    const { conditionName, task } = request.body ?? {};

    const parseResult = CreateRunSchema.safeParse({
      experimentId: id,
      conditionName,
      task,
    });
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid run input',
        details: parseResult.error.issues,
      });
    }

    try {
      const run = await createRun(
        parseResult.data.experimentId,
        parseResult.data.conditionName,
        parseResult.data.task,
      );
      return reply.status(201).send(run);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Experiment not found')) {
        return reply.status(404).send({ error: msg });
      }
      if (msg.includes('Condition') && msg.includes('not found')) {
        return reply.status(400).send({ error: msg });
      }
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * GET /lab/:id/runs/:runId — Get run details including metrics.
   *
   * Returns the Run object (with metrics if completed) or 404.
   */
  app.get<{
    Params: { id: string; runId: string };
  }>('/lab/:id/runs/:runId', async (request, reply) => {
    const { id, runId } = request.params;

    try {
      const run = await getRun(id, runId);
      return reply.status(200).send(run);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: msg });
      }
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * POST /lab/:id/runs/:runId/config — Write config.yaml for a run.
   *
   * Body: { config: Record<string, unknown> }
   * Must be called BEFORE the first cycle event (invariant enforcement).
   * Returns 200 on success.
   */
  app.post<{
    Params: { id: string; runId: string };
    Body: { config?: Record<string, unknown> };
  }>('/lab/:id/runs/:runId/config', async (request, reply) => {
    const { id, runId } = request.params;
    const { config } = request.body ?? {};

    if (!config || typeof config !== 'object') {
      return reply.status(400).send({ error: 'Missing required field: config' });
    }

    try {
      await captureRunConfig(id, runId, config);
      return reply.status(200).send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  /**
   * POST /lab/:id/runs/:runId/environment — Refresh environment capture for a run.
   *
   * Useful if the environment snapshot needs to be re-taken after run creation.
   * Returns 200 on success.
   */
  app.post<{
    Params: { id: string; runId: string };
  }>('/lab/:id/runs/:runId/environment', async (request, reply) => {
    const { id, runId } = request.params;

    try {
      await captureEnvironment(id, runId);
      return reply.status(200).send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  /**
   * GET /lab/:id/runs/:runId/traces — Get filtered trace events for a run.
   *
   * Query params (all optional):
   *   cycleNumber — filter by cycle number
   *   moduleId    — filter by module ID
   *   phase       — filter by execution phase
   *
   * Returns an array of TraceRecord objects.
   */
  app.get<{
    Params: { id: string; runId: string };
    Querystring: {
      cycleNumber?: string;
      moduleId?: string;
      phase?: string;
    };
  }>('/lab/:id/runs/:runId/traces', async (request, reply) => {
    const { id, runId } = request.params;
    const query = request.query;

    const filter: TraceFilter = {};
    if (query.cycleNumber !== undefined) {
      const n = parseInt(query.cycleNumber, 10);
      if (!isNaN(n)) filter.cycleNumber = n;
    }
    if (query.moduleId) filter.moduleId = query.moduleId;
    if (query.phase) filter.phase = query.phase;

    try {
      const traces = await readTraces(id, runId, Object.keys(filter).length > 0 ? filter : undefined);
      return reply.status(200).send(traces);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  /**
   * GET /lab/:id/runs/:runId/events — Get raw events for a run.
   *
   * Returns the complete BridgeEvent array from events.jsonl.
   * Useful for debugging and full event inspection.
   */
  app.get<{
    Params: { id: string; runId: string };
  }>('/lab/:id/runs/:runId/events', async (request, reply) => {
    const { id, runId } = request.params;

    try {
      const events = await readEvents(id, runId);
      return reply.status(200).send(events);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
