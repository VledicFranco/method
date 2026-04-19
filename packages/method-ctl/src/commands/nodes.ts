// SPDX-License-Identifier: Apache-2.0
// ── method-ctl nodes ────────────────────────────────────────────
//
// Without name: GET /cluster/nodes — list all nodes.
// With name: GET /cluster/nodes/:name — single node detail.

export interface NodesOptions {
  bridge: string;
  format: 'table' | 'json';
  name?: string;
}

// ── Response types (matches bridge /cluster/nodes JSON) ─────────

interface NodeResource {
  nodeId: string;
  instanceName: string;
  cpuCount: number;
  cpuLoadPercent: number;
  memoryTotalMb: number;
  memoryAvailableMb: number;
  sessionsActive: number;
  sessionsMax: number;
  projectCount: number;
  uptimeMs: number;
  version: string;
}

interface ClusterNodeResponse {
  nodeId: string;
  instanceName: string;
  address: { host: string; port: number };
  resources: NodeResource;
  status: string;
  lastSeen: number;
  projects: Array<{ projectId: string; name: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

// ── Single node detail ──────────────────────────────────────────

function printNodeDetail(node: ClusterNodeResponse): void {
  const r = node.resources;
  const memUsed = r.memoryTotalMb - r.memoryAvailableMb;

  process.stdout.write(`Node: ${node.instanceName}\n`);
  process.stdout.write(`  ID:       ${node.nodeId}\n`);
  process.stdout.write(`  Address:  ${node.address.host}:${node.address.port}\n`);
  process.stdout.write(`  Status:   ${node.status}\n`);
  process.stdout.write(`  Version:  ${r.version}\n`);
  process.stdout.write(`  Uptime:   ${formatUptime(r.uptimeMs)}\n`);
  process.stdout.write(`  Sessions: ${r.sessionsActive}/${r.sessionsMax}\n`);
  process.stdout.write(`  CPU:      ${r.cpuCount} cores, ${Math.round(r.cpuLoadPercent)}% load\n`);
  process.stdout.write(`  Memory:   ${formatMb(memUsed)} / ${formatMb(r.memoryTotalMb)} (${Math.round((memUsed / r.memoryTotalMb) * 100)}%)\n`);
  process.stdout.write(`  Projects: ${node.projects.length}\n`);

  if (node.projects.length > 0) {
    process.stdout.write(`\n  Project List:\n`);
    for (const p of node.projects) {
      process.stdout.write(`    - ${p.name} (${p.projectId})\n`);
    }
  }
}

// ── Command ─────────────────────────────────────────────────────

export async function nodesCommand(options: NodesOptions): Promise<void> {
  const { bridge, format, name } = options;

  const url = name
    ? `http://${bridge}/cluster/nodes/${encodeURIComponent(name)}`
    : `http://${bridge}/cluster/nodes`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: Could not connect to bridge at ${bridge}\n`);
    process.stderr.write(`  ${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (response.status === 404 && name) {
    process.stderr.write(`Error: Node '${name}' not found\n`);
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    process.stderr.write(`Error: Bridge returned ${response.status} ${response.statusText}\n`);
    process.exitCode = 1;
    return;
  }

  // Single node detail
  if (name) {
    const node: ClusterNodeResponse = await response.json() as ClusterNodeResponse;

    if (format === 'json') {
      process.stdout.write(JSON.stringify(node, null, 2) + '\n');
      return;
    }

    printNodeDetail(node);
    return;
  }

  // Node list — bridge wraps in { nodes: [...] }
  const body = await response.json() as { nodes: ClusterNodeResponse[] } | ClusterNodeResponse[];
  const nodes: ClusterNodeResponse[] = Array.isArray(body) ? body : body.nodes;

  if (format === 'json') {
    process.stdout.write(JSON.stringify(nodes, null, 2) + '\n');
    return;
  }

  if (nodes.length === 0) {
    process.stdout.write('No nodes in cluster.\n');
    return;
  }

  const cols = [
    { name: 'Node', width: 22 },
    { name: 'Status', width: 10 },
    { name: 'Address', width: 32 },
    { name: 'Sessions', width: 10 },
    { name: 'CPU', width: 14 },
    { name: 'Memory', width: 20 },
    { name: 'Projects', width: 10 },
    { name: 'Uptime', width: 10 },
  ];

  const header = cols.map(c => pad(c.name, c.width)).join('  ');
  const separator = cols.map(c => '-'.repeat(c.width)).join('  ');

  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');

  for (const node of nodes) {
    const r = node.resources;
    const memUsed = r.memoryTotalMb - r.memoryAvailableMb;
    const memPct = r.memoryTotalMb > 0 ? Math.round((memUsed / r.memoryTotalMb) * 100) : 0;

    const row = [
      pad(node.instanceName, cols[0].width),
      pad(node.status, cols[1].width),
      pad(`${node.address.host}:${node.address.port}`, cols[2].width),
      pad(`${r.sessionsActive}/${r.sessionsMax}`, cols[3].width),
      pad(`${r.cpuCount}c ${Math.round(r.cpuLoadPercent)}%`, cols[4].width),
      pad(`${formatMb(memUsed)}/${formatMb(r.memoryTotalMb)} ${memPct}%`, cols[5].width),
      pad(`${node.projects.length}`, cols[6].width),
      pad(formatUptime(r.uptimeMs), cols[7].width),
    ];
    process.stdout.write(row.join('  ') + '\n');
  }
}
