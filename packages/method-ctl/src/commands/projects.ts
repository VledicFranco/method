// SPDX-License-Identifier: Apache-2.0
// ── method-ctl projects ─────────────────────────────────────────
//
// GET /cluster/state, aggregate project lists from all nodes.
// Show which projects are on which nodes.

export interface ProjectsOptions {
  bridge: string;
  format: 'table' | 'json';
}

// ── Response types ──────────────────────────────────────────────

interface ClusterNodeResponse {
  nodeId: string;
  instanceName: string;
  address: { host: string; port: number };
  resources: {
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
  };
  status: string;
  lastSeen: number;
  projects: Array<{ projectId: string; name: string }>;
}

interface ClusterStateResponse {
  self: ClusterNodeResponse;
  peers: Record<string, ClusterNodeResponse>;
  generation: number;
}

// ── Aggregation ─────────────────────────────────────────────────

interface ProjectEntry {
  projectId: string;
  name: string;
  nodes: string[];
  status: 'available' | 'degraded';
}

function aggregateProjects(allNodes: ClusterNodeResponse[]): ProjectEntry[] {
  const projectMap = new Map<string, ProjectEntry>();

  for (const node of allNodes) {
    // Only consider alive nodes for project availability
    const nodeAlive = node.status === 'alive';

    for (const project of node.projects) {
      let entry = projectMap.get(project.projectId);
      if (!entry) {
        entry = {
          projectId: project.projectId,
          name: project.name,
          nodes: [],
          status: 'available',
        };
        projectMap.set(project.projectId, entry);
      }
      entry.nodes.push(node.instanceName);
      // If any hosting node is not alive, mark as degraded
      if (!nodeAlive) {
        entry.status = 'degraded';
      }
    }
  }

  // Sort by project name
  return Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Helpers ──────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

// ── Command ─────────────────────────────────────────────────────

export async function projectsCommand(options: ProjectsOptions): Promise<void> {
  const { bridge, format } = options;
  const url = `http://${bridge}/cluster/state`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: Could not connect to bridge at ${bridge}\n`);
    process.stderr.write(`  ${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    process.stderr.write(`Error: Bridge returned ${response.status} ${response.statusText}\n`);
    process.exitCode = 1;
    return;
  }

  const state: ClusterStateResponse = await response.json() as ClusterStateResponse;

  const allNodes: ClusterNodeResponse[] = [
    state.self,
    ...Object.values(state.peers),
  ];

  const projects = aggregateProjects(allNodes);

  if (format === 'json') {
    process.stdout.write(JSON.stringify(projects, null, 2) + '\n');
    return;
  }

  if (projects.length === 0) {
    process.stdout.write('No projects found across cluster.\n');
    return;
  }

  const cols = [
    { name: 'Project', width: 30 },
    { name: 'Nodes', width: 40 },
    { name: 'Status', width: 12 },
  ];

  const header = cols.map(c => pad(c.name, c.width)).join('  ');
  const separator = cols.map(c => '-'.repeat(c.width)).join('  ');

  process.stdout.write(`Projects across cluster (${projects.length} total)\n\n`);
  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');

  for (const project of projects) {
    const row = [
      pad(project.name, cols[0].width),
      pad(project.nodes.join(', '), cols[1].width),
      pad(project.status, cols[2].width),
    ];
    process.stdout.write(row.join('  ') + '\n');
  }
}
