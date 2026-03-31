// ── Cluster Domain Config ────────────────────────────────────────
//
// Zod-validated configuration for the bridge cluster domain.
// All values load from CLUSTER_* environment variables with
// sensible defaults for single-node operation (CLUSTER_ENABLED=false).
//
// Node ID persistence (reading/writing .method/cluster-node-id) is
// handled by resolvePersistedNodeId(), which accepts a FileSystemProvider
// port — not a direct fs import. The composition root calls this.

import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// ── Persistent Node ID (port-based) ─────────────────────────────

/** Minimal FS port for node ID persistence — avoids direct node:fs import. */
export interface NodeIdFs {
  readFileSync(path: string, encoding: 'utf-8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
}

/**
 * Read the persisted node ID from .method/cluster-node-id, or generate
 * a new UUID and persist it for future runs.
 *
 * @param envValue  The CLUSTER_NODE_ID env var (takes precedence if set)
 * @param fs        File system port for persistence (optional — generates ephemeral ID if absent)
 * @param basePath  Base directory for .method (defaults to cwd)
 */
export function resolvePersistedNodeId(
  envValue: string | undefined,
  fs?: NodeIdFs,
  basePath?: string,
): string {
  // Explicit env override takes precedence
  if (envValue && envValue.length > 0) return envValue;

  const base = basePath ?? process.cwd();
  const idPath = `${base}/.method/cluster-node-id`;

  // Try reading persisted ID
  if (fs) {
    try {
      const stored = fs.readFileSync(idPath, 'utf-8').trim();
      if (stored.length > 0) return stored;
    } catch {
      // File does not exist — generate a new one
    }
  }

  const id = randomUUID();

  // Persist for next run
  if (fs) {
    try {
      const dir = idPath.substring(0, idPath.lastIndexOf('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(idPath, id, 'utf-8');
    } catch {
      // Non-fatal — ID will be ephemeral this run
    }
  }

  return id;
}

// ── Zod Schema ────────────────────────────────────────────────────

export const ClusterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  nodeId: z.string().min(1),
  seeds: z.string().default(''),
  heartbeatMs: z.number().int().positive().default(5000),
  suspectTimeoutMs: z.number().int().positive().default(15000),
  stateBroadcastMs: z.number().int().positive().default(10000),
  federationEnabled: z.boolean().default(true),
  federationFilterSeverity: z.string().default('warning,error,critical'),
  federationFilterDomain: z.string().default(''),
  /** Instance name passed from composition root (avoids process.env in core). */
  instanceName: z.string().optional(),
  /** Host address passed from composition root. */
  host: z.string().optional(),
  /** Port passed from composition root. */
  port: z.number().int().positive().optional(),
  /** Shared secret for authenticating cluster POST requests. When set, peers must include x-cluster-secret header. */
  clusterSecret: z.string().optional(),
  /** Maximum number of peers allowed. Joins beyond this limit are rejected. */
  maxPeers: z.number().int().positive().default(50),
});

export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;

/**
 * Load cluster config from process.env CLUSTER_* variables.
 *
 * @param fs  Optional file system port for node ID persistence.
 *            When omitted, CLUSTER_NODE_ID env var is required, or
 *            an ephemeral UUID is generated.
 */
export function loadClusterConfig(fs?: NodeIdFs): ClusterConfig {
  return ClusterConfigSchema.parse({
    enabled: process.env.CLUSTER_ENABLED === 'true',
    nodeId: resolvePersistedNodeId(process.env.CLUSTER_NODE_ID, fs),
    seeds: process.env.CLUSTER_SEEDS ?? '',
    heartbeatMs: process.env.CLUSTER_HEARTBEAT_MS
      ? parseInt(process.env.CLUSTER_HEARTBEAT_MS, 10)
      : undefined,
    suspectTimeoutMs: process.env.CLUSTER_SUSPECT_TIMEOUT_MS
      ? parseInt(process.env.CLUSTER_SUSPECT_TIMEOUT_MS, 10)
      : undefined,
    stateBroadcastMs: process.env.CLUSTER_STATE_BROADCAST_MS
      ? parseInt(process.env.CLUSTER_STATE_BROADCAST_MS, 10)
      : undefined,
    federationEnabled: process.env.CLUSTER_FEDERATION_ENABLED !== undefined
      ? process.env.CLUSTER_FEDERATION_ENABLED === 'true'
      : undefined,
    federationFilterSeverity: process.env.CLUSTER_FEDERATION_FILTER_SEVERITY ?? undefined,
    federationFilterDomain: process.env.CLUSTER_FEDERATION_FILTER_DOMAIN ?? undefined,
    instanceName: process.env.INSTANCE_NAME ?? undefined,
    host: process.env.HOST ?? undefined,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    clusterSecret: process.env.CLUSTER_SECRET ?? undefined,
    maxPeers: process.env.CLUSTER_MAX_PEERS
      ? parseInt(process.env.CLUSTER_MAX_PEERS, 10)
      : undefined,
  });
}
