/**
 * Experiments domain — core logic (PRD 041 Phase 2).
 *
 * Experiment CRUD, run lifecycle, config capture, environment capture.
 * Uses the file-system port (DR-15) — no direct fs imports.
 *
 * Invariants:
 * - config.yaml is always written before the first cycle event
 * - An experiment must exist before a run can be created (AC-07)
 * - environment.yaml is captured on run creation
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';
import type {
  Experiment,
  Run,
  RunMetrics,
  Condition,
  ExperimentStatus,
} from './types.js';
import { CreateExperimentSchema, CreateRunSchema } from './config.js';
import type { CreateExperimentInput, CreateRunInput } from './config.js';

// ── Port injection ──────────────────────────────────────────────

let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** Configure file-system and YAML ports for this module. Called from composition root. */
export function setCorePorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

function getFs(): FileSystemProvider {
  if (!_fs) throw new Error('Experiments core: file-system port not configured. Call setCorePorts().');
  return _fs;
}

function getYaml(): YamlLoader {
  if (!_yaml) throw new Error('Experiments core: YAML port not configured. Call setCorePorts().');
  return _yaml;
}

// ── Data directory resolution ───────────────────────────────────

let _dataDir = 'data/experiments';

/** Override the data directory (for tests or alternate instances). */
export function setDataDir(dir: string): void {
  _dataDir = dir;
}

function experimentDir(experimentId: string): string {
  return join(_dataDir, experimentId);
}

function runDir(experimentId: string, runId: string): string {
  return join(_dataDir, experimentId, 'runs', runId);
}

// ── Experiment CRUD ─────────────────────────────────────────────

/**
 * Create a new experiment.
 *
 * Validates input, generates a UUID, writes experiment.yaml to
 * `data/experiments/{id}/experiment.yaml`, and returns the created experiment.
 */
export async function createExperiment(input: CreateExperimentInput): Promise<Experiment> {
  const validated = CreateExperimentSchema.parse(input);
  const fs = getFs();
  const yaml = getYaml();

  const now = new Date().toISOString();
  const experiment: Experiment = {
    id: randomUUID(),
    name: validated.name,
    hypothesis: validated.hypothesis,
    conditions: validated.conditions as Condition[],
    tasks: validated.tasks,
    status: 'drafting' as ExperimentStatus,
    createdAt: now,
    updatedAt: now,
  };

  const dir = experimentDir(experiment.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'experiment.yaml'), yaml.dump(experiment), 'utf-8');

  return experiment;
}

/**
 * Get an experiment by ID.
 *
 * Reads and parses experiment.yaml. Throws if not found.
 */
export async function getExperiment(id: string): Promise<Experiment> {
  const fs = getFs();
  const yaml = getYaml();

  const filePath = join(experimentDir(id), 'experiment.yaml');

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Experiment not found: ${id}`);
  }

  return yaml.load(content) as Experiment;
}

/**
 * List all experiments.
 *
 * Scans the data directory for experiment.yaml files and returns them all.
 * Errors for individual files are swallowed (non-fatal) to keep the list
 * working even if one experiment file is corrupt.
 */
export async function listExperiments(): Promise<Experiment[]> {
  const fs = getFs();
  const yaml = getYaml();

  let entries: string[];
  try {
    entries = await fs.readdir(_dataDir);
  } catch {
    // Data dir doesn't exist yet — return empty list
    return [];
  }

  const experiments: Experiment[] = [];

  for (const entry of entries) {
    const filePath = join(_dataDir, entry, 'experiment.yaml');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const exp = yaml.load(content) as Experiment;
      experiments.push(exp);
    } catch {
      // Skip corrupt or missing experiment files
    }
  }

  return experiments;
}

/**
 * Update the status of an existing experiment.
 *
 * Reads experiment.yaml, updates the status field, writes back.
 */
export async function updateExperimentStatus(
  id: string,
  status: ExperimentStatus,
): Promise<Experiment> {
  const fs = getFs();
  const yaml = getYaml();

  const experiment = await getExperiment(id);
  const updated: Experiment = {
    ...experiment,
    status,
    updatedAt: new Date().toISOString(),
  };

  const filePath = join(experimentDir(id), 'experiment.yaml');
  await fs.writeFile(filePath, yaml.dump(updated), 'utf-8');

  return updated;
}

// ── Run lifecycle ───────────────────────────────────────────────

/**
 * Create a new run for a given experiment, condition, and task.
 *
 * AC-07: Throws "Experiment not found. Create an experiment first." if the
 * experiment does not exist.
 *
 * Validates that the conditionName references a known condition in the experiment.
 * Writes initial status.json with status='running' and writes environment.yaml.
 */
export async function createRun(
  experimentId: string,
  conditionName: string,
  task: string,
): Promise<Run> {
  const validated = CreateRunSchema.parse({ experimentId, conditionName, task });

  // AC-07: Experiment must exist first
  let experiment: Experiment;
  try {
    experiment = await getExperiment(validated.experimentId);
  } catch {
    throw new Error('Experiment not found. Create an experiment first.');
  }

  // Validate conditionName exists in the experiment
  const conditionExists = experiment.conditions.some(
    (c) => c.name === validated.conditionName,
  );
  if (!conditionExists) {
    throw new Error(
      `Condition "${validated.conditionName}" not found in experiment "${validated.experimentId}". ` +
      `Available conditions: ${experiment.conditions.map((c) => c.name).join(', ')}`,
    );
  }

  const fs = getFs();
  const yaml = getYaml();

  const now = new Date().toISOString();
  const run: Run = {
    id: randomUUID(),
    experimentId: validated.experimentId,
    conditionName: validated.conditionName,
    task: validated.task,
    status: 'running',
    startedAt: now,
  };

  const dir = runDir(validated.experimentId, run.id);
  await fs.mkdir(dir, { recursive: true });

  // Write initial status.json
  const statusData = {
    status: run.status,
    startedAt: run.startedAt,
    runId: run.id,
    experimentId: run.experimentId,
    conditionName: run.conditionName,
    task: run.task,
  };
  await fs.writeFile(join(dir, 'status.json'), JSON.stringify(statusData, null, 2), 'utf-8');

  // Capture environment immediately on creation
  await captureEnvironment(validated.experimentId, run.id);

  // Update experiment status to running if it was drafting
  if (experiment.status === 'drafting') {
    await updateExperimentStatus(validated.experimentId, 'running');
  }

  return run;
}

/**
 * Read a run's current state from disk.
 *
 * Reads status.json and, if completed, merges in metrics.json.
 */
export async function getRun(experimentId: string, runId: string): Promise<Run> {
  const fs = getFs();

  const dir = runDir(experimentId, runId);
  const statusPath = join(dir, 'status.json');

  let statusContent: string;
  try {
    statusContent = await fs.readFile(statusPath, 'utf-8');
  } catch {
    throw new Error(`Run not found: ${runId} in experiment ${experimentId}`);
  }

  const statusData = JSON.parse(statusContent) as {
    status: string;
    startedAt: string;
    completedAt?: string;
    runId: string;
    experimentId: string;
    conditionName: string;
    task: string;
  };

  const run: Run = {
    id: statusData.runId,
    experimentId: statusData.experimentId,
    conditionName: statusData.conditionName,
    task: statusData.task,
    status: statusData.status as Run['status'],
    startedAt: statusData.startedAt,
    completedAt: statusData.completedAt,
  };

  // Merge in metrics if available
  const metricsPath = join(dir, 'metrics.json');
  try {
    const metricsContent = await fs.readFile(metricsPath, 'utf-8');
    run.metrics = JSON.parse(metricsContent) as RunMetrics;
  } catch {
    // Metrics not yet available — omit
  }

  return run;
}

/**
 * List all runs for an experiment.
 *
 * Scans the runs/ subdirectory for run directories and reads each status.json.
 */
export async function listRuns(experimentId: string): Promise<Run[]> {
  const fs = getFs();

  const runsDir = join(_dataDir, experimentId, 'runs');
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return [];
  }

  const runs: Run[] = [];
  for (const entry of entries) {
    try {
      const run = await getRun(experimentId, entry);
      runs.push(run);
    } catch {
      // Skip runs with missing/corrupt status.json
    }
  }

  return runs;
}

/**
 * Write config.yaml for a run BEFORE the first cycle.
 *
 * The config should contain the full resolved CreateCognitiveAgentOptions
 * so the run is reproducible. This is a domain invariant — always call
 * captureRunConfig before emitting the first cycle event.
 */
export async function captureRunConfig(
  experimentId: string,
  runId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const fs = getFs();
  const yaml = getYaml();

  const dir = runDir(experimentId, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'config.yaml'), yaml.dump(config), 'utf-8');
}

/**
 * Capture the environment state for a run.
 *
 * Writes environment.yaml with:
 * - git SHA (via git rev-parse HEAD)
 * - node version
 * - package versions from key package.json files
 *
 * Errors are non-fatal — if git is unavailable or package.json files
 * can't be read, we record what we can.
 */
export async function captureEnvironment(
  experimentId: string,
  runId: string,
): Promise<void> {
  const fs = getFs();
  const yaml = getYaml();

  const environment: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  // Capture git SHA
  try {
    const { execSync } = await import('node:child_process');
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    environment.gitSha = sha;
  } catch {
    environment.gitSha = null;
  }

  // Capture package versions from key package.json files
  const packagePaths = [
    'packages/bridge/package.json',
    'packages/pacta/package.json',
    'packages/methodts/package.json',
    'packages/mcp/package.json',
  ];

  const packageVersions: Record<string, string | null> = {};
  for (const pkgPath of packagePaths) {
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const parsed = JSON.parse(content) as { name?: string; version?: string };
      if (parsed.name && parsed.version) {
        packageVersions[parsed.name] = parsed.version;
      }
    } catch {
      // Package file not found or unreadable — skip
    }
  }
  environment.packageVersions = packageVersions;

  const dir = runDir(experimentId, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'environment.yaml'), yaml.dump(environment), 'utf-8');
}

/**
 * Mark a run as completed and write metrics.json.
 *
 * Updates status.json to 'completed' with completedAt timestamp.
 */
export async function completeRun(
  experimentId: string,
  runId: string,
  metrics: RunMetrics,
): Promise<void> {
  const fs = getFs();

  const dir = runDir(experimentId, runId);
  const completedAt = new Date().toISOString();

  // Write metrics.json
  await fs.writeFile(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf-8');

  // Update status.json
  const statusPath = join(dir, 'status.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(statusPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // Status file missing — create minimal entry
  }

  await fs.writeFile(
    statusPath,
    JSON.stringify({ ...existing, status: 'completed', completedAt }, null, 2),
    'utf-8',
  );
}

/**
 * Mark a run as failed.
 *
 * Updates status.json to 'failed' with an error message and completedAt timestamp.
 */
export async function failRun(
  experimentId: string,
  runId: string,
  error: string,
): Promise<void> {
  const fs = getFs();

  const dir = runDir(experimentId, runId);
  const completedAt = new Date().toISOString();

  const statusPath = join(dir, 'status.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(statusPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // Status file missing — create minimal entry
  }

  await fs.writeFile(
    statusPath,
    JSON.stringify({ ...existing, status: 'failed', completedAt, error }, null, 2),
    'utf-8',
  );
}
