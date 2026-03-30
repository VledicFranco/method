/**
 * Experiment MCP tool handlers (PRD 041 Phase 3).
 *
 * 8 tools for agent-driven experiment orchestration:
 * - experiment_create   — create a new experiment with conditions and tasks
 * - experiment_run      — create a run for a condition × task pair
 * - experiment_results  — get experiment details or a specific run with metrics
 * - experiment_compare  — compare two or more runs (config diff + metric deltas)
 * - lab_list_presets    — list available cognitive agent preset configurations
 * - lab_describe_module — describe a cognitive module's config schema
 * - lab_read_traces     — read filtered trace records for a run
 * - lab_read_workspace  — read workspace state for a session (future feature)
 *
 * Architecture: thin adapter layer (DR-04). All business logic lives in the
 * experiments domain on the bridge. Handlers validate → fetch → format only.
 */

import { z } from "zod";
import {
  ExperimentCreateSchema,
  ExperimentRunSchema,
  ExperimentResultsSchema,
  ExperimentCompareSchema,
  LabListPresetsSchema,
  LabDescribeModuleSchema,
  LabReadTracesSchema,
  LabReadWorkspaceSchema,
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
// Factory (mirrors createBridgeHandler in bridge-tools.ts)
// ---------------------------------------------------------------------------

function createExperimentHandler<T extends z.ZodRawShape>(config: {
  schema: z.ZodObject<T>;
  handler: (parsed: z.infer<z.ZodObject<T>>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult>;
}): (args: Record<string, unknown>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult> {
  return async (args, bridgeFetch, bridgeUrl) => {
    const parsed = config.schema.parse(args);
    return config.handler(parsed, bridgeFetch, bridgeUrl);
  };
}

// ---------------------------------------------------------------------------
// Known cognitive module registry (static, derived from @method/pacta)
// ---------------------------------------------------------------------------

const MODULE_REGISTRY: Record<string, { description: string; configSchema: Record<string, unknown>; monitoringType: string }> = {
  monitor: {
    description: "Core monitoring module — tracks prediction errors, precision weighting, and adaptive confidence thresholds.",
    configSchema: { confidenceThreshold: "number (default: 0.3)" },
    monitoringType: "cognitive.monitor_decision",
  },
  "monitor-v2": {
    description: "MonitorV2 — enhanced monitoring with prediction-error tracking, precision weighting, and EVC-based intervention gating.",
    configSchema: { confidenceThreshold: "number (default: 0.3)", evhThreshold: "number (default: 0.5)" },
    monitoringType: "cognitive.monitor_decision",
  },
  "priority-attend": {
    description: "PriorityAttend — three-factor biased competition salience function for workspace prioritization.",
    configSchema: { topK: "number (default: 8)", recencyWeight: "number", urgencyWeight: "number", relevanceWeight: "number" },
    monitoringType: "cognitive.module_step",
  },
  "reasoner-actor": {
    description: "ReasonerActor — base reasoning and action execution module.",
    configSchema: { maxToolsPerCycle: "number (default: 5)" },
    monitoringType: "cognitive.module_step",
  },
  "reasoner-actor-v2": {
    description: "ReasonerActorV2 — enhanced with SOAR impasse detection and auto-subgoaling.",
    configSchema: { maxToolsPerCycle: "number (default: 5)", subgoalDepth: "number (default: 2)" },
    monitoringType: "cognitive.module_step",
  },
  "precision-adapter": {
    description: "PrecisionAdapter — continuous effort allocation wrapper that adjusts provider calls based on precision estimates.",
    configSchema: { minPrecision: "number", maxPrecision: "number" },
    monitoringType: "cognitive.module_step",
  },
  affect: {
    description: "AffectModule — valence/arousal affect state tracking for emotionally-informed decision making (PRD 037).",
    configSchema: { decayRate: "number", valenceRange: "[number, number]" },
    monitoringType: "cognitive.module_step",
  },
  curiosity: {
    description: "CuriosityModule — epistemic curiosity drive that biases exploration toward novel or uncertain workspace regions (PRD 037).",
    configSchema: { explorationWeight: "number", noveltyDecay: "number" },
    monitoringType: "cognitive.module_step",
  },
};

// ---------------------------------------------------------------------------
// Handler definitions
// ---------------------------------------------------------------------------

/**
 * experiment_create — POST /lab
 * Creates a new experiment with named conditions and tasks.
 */
const experiment_create = createExperimentHandler({
  schema: ExperimentCreateSchema,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const res = await bridgeFetch(`${bridgeUrl}/lab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: parsed.name,
        hypothesis: parsed.hypothesis,
        conditions: parsed.conditions,
        tasks: parsed.tasks,
      }),
    });

    const data = await res.json() as {
      id: string;
      name: string;
      hypothesis: string;
      conditions: unknown[];
      tasks: string[];
      status: string;
      createdAt: string;
    };

    return ok(JSON.stringify({
      experimentId: data.id,
      experiment: data,
      message: `Experiment '${data.name}' created with ${data.conditions.length} condition(s) and ${data.tasks.length} task(s).`,
    }, null, 2));
  },
});

/**
 * experiment_run — POST /lab/:experimentId/runs
 * Creates a new run for a condition × task pair.
 * Returns a clear error if the experiment is not found (404).
 */
const experiment_run = createExperimentHandler({
  schema: ExperimentRunSchema,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    let res: Response;
    try {
      res = await bridgeFetch(`${bridgeUrl}/lab/${encodeURIComponent(parsed.experimentId)}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditionName: parsed.conditionName,
          task: parsed.task,
        }),
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('experiment not found')) {
        return err(`Experiment not found: no experiment with ID '${parsed.experimentId}' exists. Use experiment_create first or verify the experimentId.`);
      }
      throw e;
    }

    const data = await res.json() as {
      id: string;
      experimentId: string;
      conditionName: string;
      task: string;
      status: string;
      startedAt: string;
    };

    return ok(JSON.stringify({
      runId: data.id,
      run: data,
      message: `Run created for condition '${data.conditionName}' in experiment '${data.experimentId}'. Status: ${data.status}.`,
    }, null, 2));
  },
});

/**
 * experiment_results — GET /lab/:experimentId or GET /lab/:experimentId/runs/:runId
 * Retrieves experiment details with all runs, or a specific run with metrics.
 */
const experiment_results = createExperimentHandler({
  schema: ExperimentResultsSchema,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    if (parsed.runId) {
      // Specific run with metrics
      const res = await bridgeFetch(
        `${bridgeUrl}/lab/${encodeURIComponent(parsed.experimentId)}/runs/${encodeURIComponent(parsed.runId)}`,
      );
      const run = await res.json() as {
        id: string;
        experimentId: string;
        conditionName: string;
        task: string;
        status: string;
        startedAt: string;
        completedAt?: string;
        metrics?: {
          cycles: number;
          totalTokens: number;
          interventions: number;
          evictions: number;
          cost?: number;
          verdict?: string;
        };
      };

      return ok(JSON.stringify({
        run,
        message: `Run '${run.id}' — status: ${run.status}${run.metrics ? `, cycles: ${run.metrics.cycles}, tokens: ${run.metrics.totalTokens}` : ' (no metrics yet — run may still be active)'}`,
      }, null, 2));
    }

    // All runs for the experiment
    const res = await bridgeFetch(`${bridgeUrl}/lab/${encodeURIComponent(parsed.experimentId)}`);
    const data = await res.json() as {
      experiment: {
        id: string;
        name: string;
        hypothesis: string;
        conditions: unknown[];
        tasks: string[];
        status: string;
        createdAt: string;
      };
      runs: Array<{
        id: string;
        conditionName: string;
        status: string;
        metrics?: { cycles: number; totalTokens: number; interventions: number };
      }>;
    };

    return ok(JSON.stringify({
      experiment: data.experiment,
      runs: data.runs,
      summary: {
        totalRuns: data.runs.length,
        completed: data.runs.filter(r => r.status === 'completed').length,
        running: data.runs.filter(r => r.status === 'running').length,
        failed: data.runs.filter(r => r.status === 'failed').length,
      },
      message: `Experiment '${data.experiment.name}' — ${data.runs.length} run(s), status: ${data.experiment.status}`,
    }, null, 2));
  },
});

// ── Run type for experiment_compare ─────────────────────────────

interface CompareRun {
  id: string;
  experimentId: string;
  conditionName: string;
  task: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  metrics?: {
    cycles: number;
    totalTokens: number;
    interventions: number;
    evictions: number;
    cost?: number;
    verdict?: string;
  };
}

/**
 * experiment_compare — fetches multiple runs and computes config diff + metric deltas.
 *
 * Accepts runIds in format: "experimentId:runId" or "experimentId/runId".
 */
const experiment_compare = createExperimentHandler({
  schema: ExperimentCompareSchema,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    // Resolve run + experiment IDs
    // Supports two formats:
    //   - "experimentId:runId"  (explicit pairing)
    //   - "experimentId/runId"  (alternate separator)
    const resolvedRuns: Array<{ experimentId: string; runId: string; rawId: string }> = [];

    for (const rawId of parsed.runIds) {
      if (rawId.includes(':')) {
        const [experimentId, runId] = rawId.split(':', 2);
        resolvedRuns.push({ experimentId, runId, rawId });
      } else if (rawId.includes('/')) {
        const [experimentId, runId] = rawId.split('/', 2);
        resolvedRuns.push({ experimentId, runId, rawId });
      } else {
        return err(
          `Cannot resolve run '${rawId}': run IDs for experiment_compare must include the experiment ID. ` +
          `Use the format "experimentId:runId" (e.g., "exp-abc:run-xyz"). ` +
          `Get the experimentId from experiment_create or experiment_results.`
        );
      }
    }

    // Fetch all runs in parallel
    type FetchResult =
      | { ok: true; run: CompareRun; rawId: string }
      | { ok: false; error: string; rawId: string };

    const fetchedRuns: FetchResult[] = await Promise.all(
      resolvedRuns.map(async ({ experimentId, runId, rawId }): Promise<FetchResult> => {
        try {
          const res = await bridgeFetch(
            `${bridgeUrl}/lab/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}`,
          );
          const run = await res.json() as CompareRun;
          return { ok: true, run, rawId };
        } catch (e) {
          return { ok: false, error: (e as Error).message, rawId };
        }
      }),
    );

    // Check for failures
    const failures = fetchedRuns.filter((r): r is { ok: false; error: string; rawId: string } => !r.ok);
    if (failures.length > 0) {
      const msgs = failures.map(f => `  - '${f.rawId}': ${f.error}`).join('\n');
      return err(`Failed to fetch ${failures.length} run(s):\n${msgs}`);
    }

    const runs = fetchedRuns
      .filter((r): r is { ok: true; run: CompareRun; rawId: string } => r.ok)
      .map(r => r.run);

    // Metric deltas (compare each run to the first)
    const baseline = runs[0];
    const metricDeltas = runs.slice(1).map(run => {
      const delta: Record<string, number | string | undefined> = {
        runId: run.id,
        conditionName: run.conditionName,
      };

      if (baseline.metrics && run.metrics) {
        delta.cycles_delta = run.metrics.cycles - baseline.metrics.cycles;
        delta.totalTokens_delta = run.metrics.totalTokens - baseline.metrics.totalTokens;
        delta.interventions_delta = run.metrics.interventions - baseline.metrics.interventions;
        delta.evictions_delta = (run.metrics.evictions ?? 0) - (baseline.metrics.evictions ?? 0);
        if (baseline.metrics.cost !== undefined && run.metrics.cost !== undefined) {
          delta.cost_delta = run.metrics.cost - baseline.metrics.cost;
        }
      } else {
        delta.note = 'Metrics unavailable — runs may still be in progress';
      }

      return delta;
    });

    // Config diff (compare condition fields across runs)
    const configKeys = ['conditionName', 'task', 'status'] as const;
    const configDiff: Record<string, Record<string, unknown>> = {};

    for (const key of configKeys) {
      const values = runs.map(r => r[key]);
      const allSame = values.every(v => v === values[0]);
      if (!allSame) {
        configDiff[key] = Object.fromEntries(runs.map(r => [r.id, r[key]]));
      }
    }

    return ok(JSON.stringify({
      baseline: {
        runId: baseline.id,
        conditionName: baseline.conditionName,
        metrics: baseline.metrics ?? null,
      },
      comparisons: metricDeltas,
      configDiff,
      message: `Compared ${runs.length} runs. ${Object.keys(configDiff).length} config field(s) differ.`,
    }, null, 2));
  },
});

/**
 * lab_list_presets — returns available cognitive agent preset names.
 * Derived statically from @method/pacta presets directory.
 */
const lab_list_presets = createExperimentHandler({
  schema: LabListPresetsSchema,
  handler: async (_parsed, _bridgeFetch, _bridgeUrl) => {
    const presets = [
      {
        name: 'enriched',
        description: 'All PRD 035 v2 modules: MonitorV2, PriorityAttend, ReasonerActorV2, PrecisionAdapter, EVC policy. Recommended baseline for experiments.',
        modules: ['monitor-v2', 'priority-attend', 'reasoner-actor-v2', 'precision-adapter'],
      },
      {
        name: 'affective',
        description: 'Enriched preset + AffectModule (PRD 037). Adds valence/arousal affect state to cognitive cycle.',
        modules: ['monitor-v2', 'priority-attend', 'reasoner-actor-v2', 'precision-adapter', 'affect'],
      },
      {
        name: 'exploratory',
        description: 'Enriched preset + CuriosityModule (PRD 037). Adds epistemic curiosity drive to workspace prioritization.',
        modules: ['monitor-v2', 'priority-attend', 'reasoner-actor-v2', 'precision-adapter', 'curiosity'],
      },
      {
        name: 'full',
        description: 'All modules: enriched + Affect + Curiosity (PRD 037). Maximum cognitive composition.',
        modules: ['monitor-v2', 'priority-attend', 'reasoner-actor-v2', 'precision-adapter', 'affect', 'curiosity'],
      },
    ];

    return ok(JSON.stringify({
      presets,
      message: `${presets.length} presets available. Use the 'preset' field in a condition to select one.`,
    }, null, 2));
  },
});

/**
 * lab_describe_module — describes a cognitive module's config schema and monitoring type.
 * Derived statically from the module registry.
 */
const lab_describe_module = createExperimentHandler({
  schema: LabDescribeModuleSchema,
  handler: async (parsed, _bridgeFetch, _bridgeUrl) => {
    const module = MODULE_REGISTRY[parsed.moduleId];

    if (!module) {
      const known = Object.keys(MODULE_REGISTRY).join(', ');
      return err(
        `Unknown module ID '${parsed.moduleId}'. ` +
        `Known modules: ${known}. ` +
        `Use lab_list_presets to see which modules are included in each preset.`
      );
    }

    return ok(JSON.stringify({
      moduleId: parsed.moduleId,
      description: module.description,
      configSchema: module.configSchema,
      monitoringType: module.monitoringType,
      message: `Module '${parsed.moduleId}': ${module.description}`,
    }, null, 2));
  },
});

/**
 * lab_read_traces — GET /lab/:experimentId/runs/:runId/traces
 * Returns filtered TraceRecord array. Query params: cycleNumber, moduleId, phase.
 */
const lab_read_traces = createExperimentHandler({
  schema: LabReadTracesSchema,
  handler: async (parsed, bridgeFetch, bridgeUrl) => {
    const params = new URLSearchParams();
    if (parsed.cycleNumber !== undefined) params.set('cycleNumber', String(parsed.cycleNumber));
    if (parsed.moduleId) params.set('moduleId', parsed.moduleId);
    if (parsed.phase) params.set('phase', parsed.phase);

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await bridgeFetch(
      `${bridgeUrl}/lab/${encodeURIComponent(parsed.experimentId)}/runs/${encodeURIComponent(parsed.runId)}/traces${qs}`,
    );

    const traces = await res.json() as Array<{
      id: string;
      timestamp: string;
      type: string;
      experimentId: string;
      runId: string;
      cycleNumber?: number;
      moduleId?: string;
      phase?: string;
      payload: Record<string, unknown>;
    }>;

    const appliedFilters: Record<string, unknown> = {};
    if (parsed.cycleNumber !== undefined) appliedFilters.cycleNumber = parsed.cycleNumber;
    if (parsed.moduleId) appliedFilters.moduleId = parsed.moduleId;
    if (parsed.phase) appliedFilters.phase = parsed.phase;

    return ok(JSON.stringify({
      traces,
      count: traces.length,
      filters: appliedFilters,
      message: `${traces.length} trace record(s) returned${Object.keys(appliedFilters).length > 0 ? ` (filtered by: ${Object.keys(appliedFilters).join(', ')})` : ''}.`,
    }, null, 2));
  },
});

/**
 * lab_read_workspace — workspace inspection for a session.
 * This endpoint is not yet available on the bridge; returns a clear message.
 */
const lab_read_workspace = createExperimentHandler({
  schema: LabReadWorkspaceSchema,
  handler: async (parsed, _bridgeFetch, _bridgeUrl) => {
    // Workspace inspection endpoint is not yet available on the bridge.
    // The cognitive workspace is an in-memory structure within the session's
    // cognitive agent cycle. Persistent workspace snapshots are planned for a
    // future PRD. See packages/pacta/src/cognitive/engine/workspace.ts.
    return ok(JSON.stringify({
      sessionId: parsed.sessionId,
      available: false,
      message: `Workspace inspection for session '${parsed.sessionId}' is not yet available. ` +
        `The cognitive workspace is an in-memory structure managed by the cognitive agent cycle. ` +
        `Persistent workspace snapshots will be exposed in a future PRD. ` +
        `To observe workspace-related events, use lab_read_traces with phase='workspace'.`,
    }, null, 2));
  },
});

// ---------------------------------------------------------------------------
// Exported handler map — keyed by tool name
// ---------------------------------------------------------------------------

export const experimentHandlers: Record<
  string,
  (args: Record<string, unknown>, bridgeFetch: BridgeFetchFn, bridgeUrl: string) => Promise<ToolResult>
> = {
  experiment_create,
  experiment_run,
  experiment_results,
  experiment_compare,
  lab_list_presets,
  lab_describe_module,
  lab_read_traces,
  lab_read_workspace,
};

// ---------------------------------------------------------------------------
// EXPERIMENT_TOOLS — MCP tool definition objects (for registration in index.ts)
// ---------------------------------------------------------------------------

export const EXPERIMENT_TOOLS = [
  {
    name: 'experiment_create',
    description: 'Create a new experiment with named conditions (cognitive agent configurations) and task prompts. Returns the experiment ID and full experiment object.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Human-readable experiment name' },
        hypothesis: { type: 'string', description: 'The research hypothesis being tested' },
        conditions: {
          type: 'array',
          description: 'Named cognitive agent configurations to compare',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Condition name (e.g., "v2-enriched-ollama")' },
              preset: { type: 'string', description: 'Preset name to use as base (see lab_list_presets)' },
              overrides: { type: 'object', description: 'Module-level parameter overrides' },
              provider: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: 'Provider type (e.g., "anthropic", "ollama")' },
                  model: { type: 'string', description: 'Model name' },
                  baseUrl: { type: 'string', description: 'Provider API base URL' },
                },
                required: ['type'],
              },
              workspace: {
                type: 'object',
                properties: { capacity: { type: 'number', description: 'Workspace entry capacity' } },
              },
              cycle: {
                type: 'object',
                properties: {
                  maxCycles: { type: 'number', description: 'Max cognitive cycles' },
                  maxToolsPerCycle: { type: 'number', description: 'Max tool calls per cycle' },
                },
              },
            },
            required: ['name'],
          },
        },
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task prompts to execute under each condition',
        },
      },
      required: ['name', 'hypothesis', 'conditions', 'tasks'],
    },
  },
  {
    name: 'experiment_run',
    description: 'Create a new run for a condition × task pair within an experiment. Returns the run ID. The experiment must exist.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        experimentId: { type: 'string', description: 'Parent experiment ID (from experiment_create)' },
        conditionName: { type: 'string', description: 'Name of the condition to run (must exist in the experiment)' },
        task: { type: 'string', description: 'Task prompt to execute' },
      },
      required: ['experimentId', 'conditionName', 'task'],
    },
  },
  {
    name: 'experiment_results',
    description: 'Get experiment details and runs list, or a specific run with metrics. Omit runId to get all runs for the experiment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        experimentId: { type: 'string', description: 'Experiment ID' },
        runId: { type: 'string', description: 'Optional: specific run ID. Omit to list all runs.' },
      },
      required: ['experimentId'],
    },
  },
  {
    name: 'experiment_compare',
    description: 'Compare two or more runs: returns config diff and metric deltas (cycles, totalTokens, interventions). Use "experimentId:runId" format for each run ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two or more run IDs in "experimentId:runId" format (e.g., ["expAbc:run1", "expAbc:run2"])',
          minItems: 2,
        },
      },
      required: ['runIds'],
    },
  },
  {
    name: 'lab_list_presets',
    description: 'List all available cognitive agent preset configurations. Presets are pre-composed module bundles that can be referenced in experiment conditions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'lab_describe_module',
    description: 'Describe a cognitive module: its purpose, config schema, and the monitoring event type it emits. Use to understand what can be configured in experiment conditions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        moduleId: {
          type: 'string',
          description: 'Module ID (e.g., "monitor-v2", "priority-attend", "reasoner-actor-v2", "affect", "curiosity")',
        },
      },
      required: ['moduleId'],
    },
  },
  {
    name: 'lab_read_traces',
    description: 'Read filtered cognitive trace records for a run. Traces are BridgeEvents with domain=cognitive. Filter by cycleNumber, moduleId, or phase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        experimentId: { type: 'string', description: 'Experiment ID' },
        runId: { type: 'string', description: 'Run ID to read traces for' },
        cycleNumber: { type: 'number', description: 'Optional: filter to a specific cycle number' },
        moduleId: { type: 'string', description: 'Optional: filter to a specific module ID' },
        phase: { type: 'string', description: 'Optional: filter to a specific execution phase (e.g., "monitor", "reason", "act")' },
      },
      required: ['experimentId', 'runId'],
    },
  },
  {
    name: 'lab_read_workspace',
    description: 'Read the workspace state for a cognitive agent session. Note: workspace inspection is not yet available — this tool returns a descriptive message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Bridge session ID to read workspace state for' },
      },
      required: ['sessionId'],
    },
  },
] as const;
