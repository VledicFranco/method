/**
 * PRD 019.2: Registry API Endpoints
 *
 * Four HTTP endpoints that serve parsed registry YAML data as JSON.
 * Scans the registry/ directory for methodology and method YAML files,
 * parses them with js-yaml (DR-05), and returns structured JSON.
 *
 * Endpoints:
 *   GET  /api/registry                     — full tree structure
 *   GET  /api/registry/manifest            — parsed manifest with sync status
 *   GET  /api/registry/:methodology/:method — full parsed method/protocol YAML
 *   POST /api/registry/reload              — invalidate cache
 */

import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { FastifyInstance } from 'fastify';

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

// ── Helpers ──

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function safeYamlLoad(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that path segments don't escape the base directory.
 * Rejects segments containing '..', '/', or '\\' and verifies the
 * resolved path stays within the base directory (path traversal guard).
 */
function safePath(base: string, ...segments: string[]): string | null {
  for (const seg of segments) {
    if (seg.includes('..') || seg.includes('/') || seg.includes('\\')) return null;
  }
  const resolved = resolve(base, ...segments);
  if (!resolved.startsWith(resolve(base))) return null;
  return resolved;
}

// ── Scanner ──

function isMethodologyDir(name: string): boolean {
  return /^P[0-9]?-/.test(name);
}

function isMethodDir(name: string): boolean {
  return /^M[0-9]+-/.test(name);
}

function isProtocolFile(name: string): boolean {
  return name.endsWith('.yaml') && (
    name.includes('PROTOCOL') ||
    name.includes('PROTO')
  );
}

async function scanRegistry(config: RegistryConfig): Promise<RegistryTree> {
  const { registryDir } = config;
  const methodologies: RegistryMethodologySummary[] = [];
  let totalMethods = 0;
  let totalProtocols = 0;
  let totalCompiled = 0;
  let totalDraft = 0;

  if (!(await pathExists(registryDir))) {
    return {
      methodologies: [],
      totals: { methodologies: 0, methods: 0, protocols: 0, compiled: 0, draft: 0 },
      cached_at: new Date().toISOString(),
    };
  }

  const topEntries = await readdir(registryDir);

  for (const dirName of topEntries) {
    if (!isMethodologyDir(dirName)) continue;

    const methodologyDir = join(registryDir, dirName);
    if (!(await isDirectory(methodologyDir))) continue;

    // Read methodology-level YAML
    const methodologyYamlPath = join(methodologyDir, `${dirName}.yaml`);
    const methodologyData = await safeYamlLoad(methodologyYamlPath);
    const meth = (methodologyData?.methodology ?? {}) as Record<string, unknown>;

    const methods: RegistryMethodSummary[] = [];
    const entries = await readdir(methodologyDir);

    // Scan for method subdirectories
    for (const entry of entries) {
      const entryPath = join(methodologyDir, entry);
      if (!(await isDirectory(entryPath))) continue;
      if (!isMethodDir(entry)) continue;

      const methodYamlPath = join(entryPath, `${entry}.yaml`);
      const methodData = await safeYamlLoad(methodYamlPath);
      if (!methodData) continue;

      const m = (methodData.method ?? {}) as Record<string, unknown>;
      const wipItems = methodData.known_wip;
      const wipCount = Array.isArray(wipItems) ? wipItems.length : 0;
      const status = (m.status as string) ?? 'draft';

      methods.push({
        id: (m.id as string) ?? entry,
        name: (m.name as string) ?? entry,
        version: (m.version as string) ?? '0.0',
        status,
        type: 'method',
        wip_count: wipCount,
      });

      totalMethods++;
      if (status === 'compiled') totalCompiled++;
      else totalDraft++;
    }

    // Scan for protocol files at methodology level
    for (const entry of entries) {
      const entryPath = join(methodologyDir, entry);
      if (!(await isFile(entryPath))) continue;
      if (!isProtocolFile(entry)) continue;

      // Skip non-protocol YAML files by parsing content
      const data = await safeYamlLoad(entryPath);
      if (!data || !data.protocol) continue;

      const p = data.protocol as Record<string, unknown>;
      const wipItems = data.known_wip;
      const wipCount = Array.isArray(wipItems) ? wipItems.length : 0;
      const status = (p.status as string) ?? (p.maturity as string) ?? 'draft';

      methods.push({
        id: (p.id as string) ?? basename(entry, '.yaml'),
        name: (p.name as string) ?? basename(entry, '.yaml'),
        version: (p.version as string) ?? '0.0',
        status,
        type: 'protocol',
        wip_count: wipCount,
      });

      totalProtocols++;
      if (status === 'promoted') totalCompiled++;
      else totalDraft++;
    }

    const methStatus = (meth.status as string) ?? 'draft';

    methodologies.push({
      id: (meth.id as string) ?? dirName,
      name: (meth.name as string) ?? dirName,
      version: (meth.version as string) ?? '0.0',
      status: methStatus,
      method_count: methods.length,
      methods,
    });
  }

  // Sort methodologies by ID for consistent ordering
  methodologies.sort((a, b) => a.id.localeCompare(b.id));

  return {
    methodologies,
    totals: {
      methodologies: methodologies.length,
      methods: totalMethods,
      protocols: totalProtocols,
      compiled: totalCompiled,
      draft: totalDraft,
    },
    cached_at: new Date().toISOString(),
  };
}

// ── Promotion Record Resolution ──

async function resolvePromotionFile(config: RegistryConfig, methodologyId: string, protocolId: string): Promise<string | null> {
  const { registryDir } = config;

  // Path traversal guard: reject segments that could escape the registry directory
  const methodologyDir = safePath(registryDir, methodologyId);
  if (!methodologyDir) return null;
  if (protocolId.includes('..') || protocolId.includes('/') || protocolId.includes('\\')) return null;

  if (!(await pathExists(methodologyDir)) || !(await isDirectory(methodologyDir))) return null;

  // Scan for *-PROMOTION.yaml files matching the protocol ID by filename convention.
  // We match by filename rather than parsed YAML content because promotion files
  // may contain YAML that fails strict parsing (e.g., mixed mapping/sequence sections).
  // The file is then parsed separately by the route handler which returns 422 on errors.
  const entries = await readdir(methodologyDir);

  // Try exact convention: {PROTOCOL-ID}-PROMOTION.yaml
  const exactName = `${protocolId}-PROMOTION.yaml`;
  if (entries.includes(exactName)) {
    const exactPath = join(methodologyDir, exactName);
    if (await isFile(exactPath)) return exactPath;
  }

  // Fallback: scan for any *-PROMOTION.yaml that contains the protocol ID in its filename
  for (const entry of entries) {
    if (!entry.endsWith('-PROMOTION.yaml') && !entry.endsWith('-PROMOTION.yml')) continue;
    if (!entry.includes(protocolId)) continue;
    const entryPath = join(methodologyDir, entry);
    if (await isFile(entryPath)) return entryPath;
  }

  return null;
}

// ── Method/Protocol Detail Resolution ──

async function resolveMethodFile(config: RegistryConfig, methodologyId: string, methodId: string): Promise<string | null> {
  const { registryDir } = config;

  // Path traversal guard: reject segments that could escape the registry directory
  const methodologyDir = safePath(registryDir, methodologyId);
  if (!methodologyDir) return null;
  const methodDir = safePath(registryDir, methodologyId, methodId);
  if (!methodDir) return null;

  // Try method subdirectory first: registry/{methodology}/{method}/{method}.yaml
  const methodDirPath = join(methodDir, `${methodId}.yaml`);
  if (await pathExists(methodDirPath)) return methodDirPath;

  // Try protocol files at methodology level (scan by parsed ID)
  if (!(await pathExists(methodologyDir)) || !(await isDirectory(methodologyDir))) return null;

  const entries = await readdir(methodologyDir);
  for (const entry of entries) {
    const entryPath = join(methodologyDir, entry);
    if (!(await isFile(entryPath))) continue;
    if (!entry.endsWith('.yaml')) continue;

    const data = await safeYamlLoad(entryPath);
    if (!data) continue;

    // Check if this file's protocol ID matches
    const protocol = data.protocol as Record<string, unknown> | undefined;
    if (protocol && (protocol.id as string) === methodId) return entryPath;

    // Also check method ID (in case someone requests by method.id from a root-level file)
    const method = data.method as Record<string, unknown> | undefined;
    if (method && (method.id as string) === methodId) return entryPath;
  }

  return null;
}

// ── Manifest ──

async function loadManifest(config: RegistryConfig, tree: RegistryTree): Promise<ManifestResponse> {
  const { manifestPath } = config;

  if (!(await pathExists(manifestPath))) {
    return { project: 'unknown', last_updated: '', installed: [] };
  }

  const data = await safeYamlLoad(manifestPath);
  if (!data || !data.manifest) {
    return { project: 'unknown', last_updated: '', installed: [] };
  }

  const manifest = data.manifest as Record<string, unknown>;
  const installed = (manifest.installed ?? []) as Array<Record<string, unknown>>;

  // Build a lookup from the registry tree for version comparison
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

export function registerRegistryRoutes(app: FastifyInstance): void {
  const config: RegistryConfig = {
    registryDir: process.env.REGISTRY_DIR ?? join(process.cwd(), 'registry'),
    manifestPath: process.env.MANIFEST_PATH ?? join(process.cwd(), '.method', 'manifest.yaml'),
    cacheTtlMs: parseInt(process.env.REGISTRY_CACHE_TTL_MS ?? '60000', 10),
  };

  /**
   * GET /api/registry — Full registry tree structure
   */
  app.get('/api/registry', async (_request, reply) => {
    const now = Date.now();
    if (treeCache && now < treeCacheExpiry) {
      return reply.status(200).send(treeCache);
    }

    const tree = await scanRegistry(config);
    treeCache = tree;
    treeCacheExpiry = now + config.cacheTtlMs;

    return reply.status(200).send(tree);
  });

  /**
   * GET /api/registry/manifest — Parsed manifest with sync status
   */
  app.get('/api/registry/manifest', async (_request, reply) => {
    // Ensure tree is populated (use cache if available)
    const now = Date.now();
    let tree: RegistryTree;
    if (treeCache && now < treeCacheExpiry) {
      tree = treeCache;
    } else {
      tree = await scanRegistry(config);
      treeCache = tree;
      treeCacheExpiry = now + config.cacheTtlMs;
    }

    const manifest = await loadManifest(config, tree);
    return reply.status(200).send(manifest);
  });

  /**
   * GET /api/registry/:methodology/:method — Full parsed method/protocol YAML as JSON
   */
  app.get<{
    Params: { methodology: string; method: string };
  }>('/api/registry/:methodology/:method', async (request, reply) => {
    const { methodology, method } = request.params;

    // Path traversal guard: reject params with traversal characters early
    if (!safePath(config.registryDir, methodology, method)) {
      return reply.status(400).send({ error: 'Invalid path parameters' });
    }

    const filePath = await resolveMethodFile(config, methodology, method);
    if (!filePath) {
      return reply.status(404).send({ error: `Method ${methodology}/${method} not found` });
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = yaml.load(content);
      return reply.status(200).send(parsed);
    } catch (e) {
      return reply.status(422).send({
        error: 'YAML parse error',
        message: (e as Error).message,
      });
    }
  });

  /**
   * GET /api/registry/:methodology/:protocol/promotion — Promotion record for a protocol
   */
  app.get<{
    Params: { methodology: string; protocol: string };
  }>('/api/registry/:methodology/:protocol/promotion', async (request, reply) => {
    const { methodology, protocol: protocolId } = request.params;

    // Path traversal guard: reject params with traversal characters early
    if (!safePath(config.registryDir, methodology) ||
        protocolId.includes('..') || protocolId.includes('/') || protocolId.includes('\\')) {
      return reply.status(400).send({ error: 'Invalid path parameters' });
    }

    const filePath = await resolvePromotionFile(config, methodology, protocolId);
    if (!filePath) {
      return reply.status(404).send({ error: `Promotion record for ${methodology}/${protocolId} not found` });
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = yaml.load(content);
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
      message: 'Registry cache invalidated. Next request will re-scan.',
    });
  });
}
