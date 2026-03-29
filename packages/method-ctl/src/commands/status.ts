// ── method-ctl status ───────────────────────────────────────────
//
// GET /cluster/state from the default bridge, display unified
// cluster health: node count, alive/suspect/dead, sessions,
// generation, per-node resource table.

export interface StatusOptions {
  bridge: string;
  format: 'table' | 'json';
}

// ── Response types (matches bridge /cluster/state JSON) ─────────

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

interface ClusterStateResponse {
  self: ClusterNodeResponse;
  peers: Record<string, ClusterNodeResponse>;
  generation: number;
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

function memoryPercent(node: ClusterNodeResponse): number {
  const total = node.resources.memoryTotalMb;
  if (total === 0) return 0;
  const used = total - node.resources.memoryAvailableMb;
  return Math.round((used / total) * 100);
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

// ── Command ─────────────────────────────────────────────────────

export async function statusCommand(options: StatusOptions): Promise<void> {
  const { bridge, format } = options;
  const url = `http://${bridge}/cluster/state`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: Could not connect to bridge at ${bridge}\n`);
    process.stderr.write(`  ${message}\n`);
    process.stderr.write(`\nIs the bridge running? Try: npm run bridge\n`);
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    process.stderr.write(`Error: Bridge returned ${response.status} ${response.statusText}\n`);
    process.exitCode = 1;
    return;
  }

  const state: ClusterStateResponse = await response.json() as ClusterStateResponse;

  if (format === 'json') {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    return;
  }

  // Collect all nodes (self + peers)
  const allNodes: ClusterNodeResponse[] = [
    state.self,
    ...Object.values(state.peers),
  ];

  // Summary counts
  const alive = allNodes.filter(n => n.status === 'alive').length;
  const suspect = allNodes.filter(n => n.status === 'suspect').length;
  const dead = allNodes.filter(n => n.status === 'dead').length;
  const draining = allNodes.filter(n => n.status === 'draining').length;
  const totalSessions = allNodes.reduce((sum, n) => sum + n.resources.sessionsActive, 0);

  process.stdout.write(`Cluster Status (generation ${state.generation})\n`);
  process.stdout.write(`Nodes: ${allNodes.length} total — ${alive} alive`);
  if (suspect > 0) process.stdout.write(`, ${suspect} suspect`);
  if (dead > 0) process.stdout.write(`, ${dead} dead`);
  if (draining > 0) process.stdout.write(`, ${draining} draining`);
  process.stdout.write(`\n`);
  process.stdout.write(`Sessions: ${totalSessions} active\n\n`);

  // Table header
  const cols = [
    { name: 'Node', width: 22 },
    { name: 'Status', width: 10 },
    { name: 'Sessions', width: 10 },
    { name: 'CPU%', width: 7 },
    { name: 'Memory%', width: 9 },
    { name: 'Projects', width: 10 },
    { name: 'Uptime', width: 10 },
  ];

  const header = cols.map(c => pad(c.name, c.width)).join('  ');
  const separator = cols.map(c => '-'.repeat(c.width)).join('  ');

  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');

  for (const node of allNodes) {
    const row = [
      pad(node.instanceName, cols[0].width),
      pad(node.status, cols[1].width),
      pad(`${node.resources.sessionsActive}/${node.resources.sessionsMax}`, cols[2].width),
      pad(`${Math.round(node.resources.cpuLoadPercent)}`, cols[3].width),
      pad(`${memoryPercent(node)}`, cols[4].width),
      pad(`${node.projects.length}`, cols[5].width),
      pad(formatUptime(node.resources.uptimeMs), cols[6].width),
    ];
    process.stdout.write(row.join('  ') + '\n');
  }
}
