/**
 * PRD 019.2: Registry API Endpoints
 *
 * Serves methodology registry data from the @method/methodts stdlib.
 * Tree and method detail endpoints use the typed stdlib catalog and metadata.
 * Manifest and promotion endpoints still read YAML (project config, not methodology data).
 *
 * Endpoints:
 *   GET  /api/registry                     — full tree structure (from stdlib)
 *   GET  /api/registry/manifest            — parsed manifest with sync status (YAML)
 *   GET  /api/registry/:methodology/:method — method detail (from stdlib)
 *   GET  /api/registry/:methodology/:protocol/promotion — promotion record (YAML)
 *   POST /api/registry/reload              — invalidate cache
 */

import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FileSystemProvider, FileStat } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';

// ── Stdlib imports ──

import { getStdlibCatalog, getMethod } from '@method/methodts/stdlib';
import { topologicalOrder } from '@method/methodts';
import {
  getMethodMetadata,
  getMethodologyMetadata,
} from '@method/methodts/stdlib/metadata';

// ── Types ──

export interface RegistryMethodSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  type: 'method' | 'protocol';
  wip_count: number;
}

export interface RegistryMethodologySummary {
  id: string;
  name: string;
  version: string;
  status: string;
  method_count: number;
  methods: RegistryMethodSummary[];
}

export interface RegistryTree {
  methodologies: RegistryMethodologySummary[];
  totals: {
    methodologies: number;
    methods: number;
    protocols: number;
    compiled: number;
    draft: number;
  };
  cached_at: string;
}

export interface ManifestEntry {
  id: string;
  type: string;
  version: string;
  registry_version: string | null;
  sync_status: 'current' | 'outdated' | 'ahead' | 'not_found';
  card?: string;
  card_version?: string;
  instance_id?: string;
  artifacts: string[];
  status?: string;
  extends?: string;
  note?: string;
}

export interface ManifestResponse {
  project: string;
  last_updated: string;
  installed: ManifestEntry[];
}

// ── Cache ──

let treeCache: RegistryTree | null = null;
let treeCacheExpiry = 0;

// ── Configuration ──

interface RegistryConfig {
  registryDir: string;
  manifestPath: string;
  cacheTtlMs: number;
}

/** PRD 024 MG-1/MG-2: Dependencies injected by composition root */
export interface RegistryRoutesDeps {
  fs: FileSystemProvider;
  yaml: YamlLoader;
}

// ── Helpers (accept fs/yaml ports) ──

function createHelpers(fs: FileSystemProvider, yamlPort: YamlLoader) {
  async function pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async function isDirectory(p: string): Promise<boolean> {
    try {
      const s = await fs.stat(p);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async function isFile(p: string): Promise<boolean> {
    try {
      const s = await fs.stat(p);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async function safeYamlLoad(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = yamlPort.load(content);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  return { pathExists, isDirectory, isFile, safeYamlLoad };
}

function safePath(base: string, ...segments: string[]): string | null {
  for (const seg of segments) {
    if (seg.includes('..') || seg.includes('/') || seg.includes('\\')) return null;
  }
  const resolved = resolve(base, ...segments);
  if (!resolved.startsWith(resolve(base))) return null;
  return resolved;
}

// ── Registry Tree (from stdlib) ──

function buildRegistryTree(): RegistryTree {
  const catalog = getStdlibCatalog();
  let totalMethods = 0;
  let totalCompiled = 0;
  let totalDraft = 0;

  const methodologies: RegistryMethodologySummary[] = catalog.map((entry) => {
    const methodologyMeta = getMethodologyMetadata(entry.methodologyId);

    const methods: RegistryMethodSummary[] = entry.methods.map((m) => {
      const meta = getMethodMetadata(entry.methodologyId, m.methodId);
      const wipCount = meta?.known_wip?.length ?? 0;
      const status = m.status;

      totalMethods++;
      if (status === 'compiled') totalCompiled++;
      else totalDraft++;

      return {
        id: m.methodId,
        name: m.name,
        version: m.version,
        status,
        type: 'method' as const,
        wip_count: wipCount,
      };
    });

    return {
      id: entry.methodologyId,
      name: entry.name,
      version: entry.version,
      status: entry.status,
      method_count: methods.length,
      methods,
    };
  });

  return {
    methodologies,
    totals: {
      methodologies: methodologies.length,
      methods: totalMethods,
      protocols: 0, // Protocols not tracked in stdlib
      compiled: totalCompiled,
      draft: totalDraft,
    },
    cached_at: new Date().toISOString(),
  };
}

// ── Method Detail (from stdlib typed Method + metadata) ──

function buildMethodDetail(methodologyId: string, methodId: string): Record<string, unknown> | null {
  const method = getMethod(methodologyId, methodId);
  const meta = getMethodMetadata(methodologyId, methodId);

  if (!method && !meta) return null;

  const result: Record<string, unknown> = {};

  // Method block
  if (meta) {
    result.method = {
      id: meta.id,
      parent: meta.parent,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      status: meta.status,
      ...(meta.compilation_date ? { compilation_date: meta.compilation_date } : {}),
      ...(meta.evolution_note ? { evolution_note: meta.evolution_note } : {}),
      ...(meta.formal_grounding ? { formal_grounding: meta.formal_grounding } : {}),
    };
  } else if (method) {
    result.method = {
      id: method.id,
      name: method.name,
      version: '1.0',
      status: 'compiled',
    };
  }

  // Navigation
  if (meta?.navigation) {
    result.navigation = {
      what: meta.navigation.what,
      who: meta.navigation.who,
      why: meta.navigation.why,
      how: meta.navigation.how,
      ...(meta.navigation.when_to_use ? { when_to_use: meta.navigation.when_to_use } : {}),
      ...(meta.navigation.when_to_invoke ? { when_to_invoke: meta.navigation.when_to_invoke } : {}),
      ...(meta.navigation.when_not_to_use ? { when_not_to_use: meta.navigation.when_not_to_use } : {}),
      ...(meta.navigation.when_not_to_invoke ? { when_not_to_invoke: meta.navigation.when_not_to_invoke } : {}),
    };
  }

  // Domain theory (from typed Method)
  if (method) {
    const domain = method.domain;
    result.domain_theory = {
      id: domain.id,
      sorts: domain.signature.sorts.map((s) => ({
        name: s.name,
        description: s.description,
        cardinality: s.cardinality,
      })),
      predicates: Object.entries(domain.signature.predicates).map(([name, pred]) => ({
        name,
        description: pred.tag === 'check' ? pred.label : undefined,
      })),
      function_symbols: domain.signature.functionSymbols.map((f) => ({
        name: f.name,
        signature: `${f.inputSorts.join(' × ')} → ${f.outputSort}`,
        totality: f.totality,
        description: f.description,
      })),
      axioms: Object.entries(domain.axioms).map(([id, pred]) => ({
        id,
        name: pred.tag === 'check' ? pred.label : id,
      })),
    };

    // Phases (from typed Method steps — use DAG order if acyclic, else raw order)
    let orderedSteps = method.dag.steps;
    let topology = 'dag';
    try {
      orderedSteps = topologicalOrder(method.dag);
      topology = 'linear';
    } catch {
      // DAG has cycles (e.g., loop-back edges) — use raw step order
      topology = 'cyclic';
    }
    result.phases = orderedSteps.map((step) => ({
      id: step.id,
      name: step.name,
      role: step.role ?? null,
      precondition: step.precondition.tag === 'check' ? step.precondition.label : null,
      postcondition: step.postcondition.tag === 'check' ? step.postcondition.label : null,
    }));

    // Step DAG
    result.step_dag = {
      topology,
      steps: orderedSteps.map((step) => ({
        id: step.id,
        name: step.name,
      })),
    };

    // Roles
    result.roles = method.roles.map((r) => ({
      id: r.id,
      description: r.description,
    }));
  }

  // Compilation record
  if (meta?.compilation_record) {
    result.compilation_record = meta.compilation_record;
  }

  // Known WIP
  if (meta?.known_wip && meta.known_wip.length > 0) {
    result.known_wip = meta.known_wip;
  }

  return result;
}

// ── Promotion Record Resolution (still YAML — protocols not in stdlib) ──

async function resolvePromotionFile(
  config: RegistryConfig,
  methodologyId: string,
  protocolId: string,
  helpers: ReturnType<typeof createHelpers>,
  fs: FileSystemProvider,
): Promise<string | null> {
  const { registryDir } = config;
  const methodologyDir = safePath(registryDir, methodologyId);
  if (!methodologyDir) return null;
  if (protocolId.includes('..') || protocolId.includes('/') || protocolId.includes('\\')) return null;
  if (!(await helpers.pathExists(methodologyDir)) || !(await helpers.isDirectory(methodologyDir))) return null;

  const entries = await fs.readdir(methodologyDir);
  const exactName = `${protocolId}-PROMOTION.yaml`;
  if (entries.includes(exactName)) {
    const exactPath = join(methodologyDir, exactName);
    if (await helpers.isFile(exactPath)) return exactPath;
  }

  for (const entry of entries) {
    if (!entry.endsWith('-PROMOTION.yaml') && !entry.endsWith('-PROMOTION.yml')) continue;
    if (!entry.includes(protocolId)) continue;
    const entryPath = join(methodologyDir, entry);
    if (await helpers.isFile(entryPath)) return entryPath;
  }

  return null;
}

// ── Manifest (still YAML — project config, not methodology data) ──

async function loadManifest(
  config: RegistryConfig,
  tree: RegistryTree,
  helpers: ReturnType<typeof createHelpers>,
): Promise<ManifestResponse> {
  const { manifestPath } = config;

  if (!(await helpers.pathExists(manifestPath))) {
    return { project: 'unknown', last_updated: '', installed: [] };
  }

  const data = await helpers.safeYamlLoad(manifestPath);
  if (!data || !data.manifest) {
    return { project: 'unknown', last_updated: '', installed: [] };
  }

  const manifest = data.manifest as Record<string, unknown>;
  const installed = (manifest.installed ?? []) as Array<Record<string, unknown>>;

  const registryVersions = new Map<string, string>();
  for (const m of tree.methodologies) {
    registryVersions.set(m.id, m.version);
    for (const method of m.methods) {
      registryVersions.set(method.id, method.version);
    }
  }

  const entries: ManifestEntry[] = installed.map((item) => {
    const id = (item.id as string) ?? '';
    const version = (item.version as string) ?? '';
    const registryVersion = registryVersions.get(id) ?? null;

    let syncStatus: ManifestEntry['sync_status'] = 'not_found';
    if (registryVersion !== null) {
      if (version === registryVersion) syncStatus = 'current';
      else if (parseFloat(version) < parseFloat(registryVersion)) syncStatus = 'outdated';
      else syncStatus = 'ahead';
    }

    const artifacts = (item.artifacts ?? []) as string[];

    return {
      id,
      type: (item.type as string) ?? 'methodology',
      version,
      registry_version: registryVersion,
      sync_status: syncStatus,
      ...(item.card ? { card: item.card as string } : {}),
      ...(item.card_version ? { card_version: item.card_version as string } : {}),
      ...(item.instance_id ? { instance_id: item.instance_id as string } : {}),
      artifacts: Array.isArray(artifacts) ? artifacts.map(String) : [],
      ...(item.status ? { status: item.status as string } : {}),
      ...(item.extends ? { extends: item.extends as string } : {}),
      ...(item.note ? { note: item.note as string } : {}),
    };
  });

  return {
    project: (manifest.project as string) ?? 'unknown',
    last_updated: (manifest.last_updated as string) ?? '',
    installed: entries,
  };
}

// ── Route Registration ──

export function registerRegistryRoutes(app: FastifyInstance, deps?: RegistryRoutesDeps): void {
  const fsPort = deps?.fs;
  const yamlPort = deps?.yaml;
  const helpers = fsPort && yamlPort ? createHelpers(fsPort, yamlPort) : null;

  const config: RegistryConfig = {
    registryDir: process.env.REGISTRY_DIR ?? join(process.cwd(), 'registry'),
    manifestPath: process.env.MANIFEST_PATH ?? join(process.cwd(), '.method', 'manifest.yaml'),
    cacheTtlMs: parseInt(process.env.REGISTRY_CACHE_TTL_MS ?? '60000', 10),
  };

  /**
   * GET /api/registry — Full registry tree structure (from stdlib catalog)
   */
  app.get('/api/registry', async (_request, reply) => {
    const now = Date.now();
    if (treeCache && now < treeCacheExpiry) {
      return reply.status(200).send(treeCache);
    }

    const tree = buildRegistryTree();
    treeCache = tree;
    treeCacheExpiry = now + config.cacheTtlMs;

    return reply.status(200).send(tree);
  });

  /**
   * GET /api/registry/manifest — Parsed manifest with sync status
   */
  app.get('/api/registry/manifest', async (_request, reply) => {
    const now = Date.now();
    let tree: RegistryTree;
    if (treeCache && now < treeCacheExpiry) {
      tree = treeCache;
    } else {
      tree = buildRegistryTree();
      treeCache = tree;
      treeCacheExpiry = now + config.cacheTtlMs;
    }

    const manifest = await loadManifest(config, tree, helpers!);
    return reply.status(200).send(manifest);
  });

  /**
   * GET /api/registry/:methodology/:method — Method detail (from stdlib)
   */
  app.get<{
    Params: { methodology: string; method: string };
  }>('/api/registry/:methodology/:method', async (request, reply) => {
    const { methodology, method } = request.params;

    // Try stdlib first
    const detail = buildMethodDetail(methodology, method);
    if (detail) {
      return reply.status(200).send(detail);
    }

    // Fallback to YAML for protocols and non-stdlib methods
    if (!safePath(config.registryDir, methodology, method)) {
      return reply.status(400).send({ error: 'Invalid path parameters' });
    }

    // Try YAML resolution
    const filePath = await resolveMethodFile(config, methodology, method, helpers!, fsPort!);
    if (!filePath) {
      return reply.status(404).send({ error: `Method ${methodology}/${method} not found` });
    }

    try {
      const content = await fsPort!.readFile(filePath, 'utf-8');
      const parsed = yamlPort!.load(content);
      return reply.status(200).send(parsed);
    } catch (e) {
      return reply.status(422).send({
        error: 'YAML parse error',
        message: (e as Error).message,
      });
    }
  });

  /**
   * GET /api/registry/:methodology/:protocol/promotion — Promotion record (YAML)
   */
  app.get<{
    Params: { methodology: string; protocol: string };
  }>('/api/registry/:methodology/:protocol/promotion', async (request, reply) => {
    const { methodology, protocol: protocolId } = request.params;

    if (!safePath(config.registryDir, methodology) ||
        protocolId.includes('..') || protocolId.includes('/') || protocolId.includes('\\')) {
      return reply.status(400).send({ error: 'Invalid path parameters' });
    }

    const filePath = await resolvePromotionFile(config, methodology, protocolId, helpers!, fsPort!);
    if (!filePath) {
      return reply.status(404).send({ error: `Promotion record for ${methodology}/${protocolId} not found` });
    }

    try {
      const content = await fsPort!.readFile(filePath, 'utf-8');
      const parsed = yamlPort!.load(content);
      return reply.status(200).send(parsed);
    } catch (e) {
      return reply.status(422).send({
        error: 'YAML parse error',
        message: (e as Error).message,
      });
    }
  });

  /**
   * POST /api/registry/reload — Invalidate cache
   */
  app.post('/api/registry/reload', async (_request, reply) => {
    treeCache = null;
    treeCacheExpiry = 0;
    return reply.status(200).send({
      status: 'ok',
      message: 'Registry cache invalidated. Next request will rebuild from stdlib.',
    });
  });
}

// ── YAML fallback for method detail (protocols, non-stdlib methods) ──

async function resolveMethodFile(
  config: RegistryConfig,
  methodologyId: string,
  methodId: string,
  helpers: ReturnType<typeof createHelpers>,
  fs: FileSystemProvider,
): Promise<string | null> {
  const { registryDir } = config;
  const methodDir = safePath(registryDir, methodologyId, methodId);
  if (!methodDir) return null;

  const methodDirPath = join(methodDir, `${methodId}.yaml`);
  if (await helpers.pathExists(methodDirPath)) return methodDirPath;

  const methodologyDir = safePath(registryDir, methodologyId);
  if (!methodologyDir || !(await helpers.pathExists(methodologyDir)) || !(await helpers.isDirectory(methodologyDir))) return null;

  const entries = await fs.readdir(methodologyDir);
  for (const entry of entries) {
    const entryPath = join(methodologyDir, entry);
    if (!(await helpers.isFile(entryPath))) continue;
    if (!entry.endsWith('.yaml')) continue;

    const data = await helpers.safeYamlLoad(entryPath);
    if (!data) continue;

    const protocol = data.protocol as Record<string, unknown> | undefined;
    if (protocol && (protocol.id as string) === methodId) return entryPath;

    const method = data.method as Record<string, unknown> | undefined;
    if (method && (method.id as string) === methodId) return entryPath;
  }

  return null;
}
