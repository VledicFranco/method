// SPDX-License-Identifier: Apache-2.0
// ── Node Resource Adapter ───────────────────────────────────────
//
// ResourceProvider implementation that reports the local machine's
// resources using Node.js OS APIs and bridge runtime stats.
//
// External dependencies (session pool stats, project count) are
// injected via callbacks to avoid coupling to other domains.

import { cpus, totalmem, freemem } from 'node:os';
import type { ResourceProvider, ResourceSnapshot } from '@methodts/cluster';

// ── Types ─────────────────────────────────────────────────────

export interface NodeResourceConfig {
  nodeId: string;
  instanceName: string;
  version: string;
  sessionsMax: number;
}

export interface NodeResourceCallbacks {
  /** Returns the number of currently active sessions. */
  getActiveSessions: () => number;
  /** Returns the total number of discovered projects. */
  getProjectCount: () => number;
}

// ── Implementation ────────────────────────────────────────────

export class NodeResource implements ResourceProvider {
  private readonly config: NodeResourceConfig;
  private readonly callbacks: NodeResourceCallbacks;
  private readonly startTime: number;

  /** Overridable for testing — returns OS-level stats. */
  public osFns: {
    cpus: () => ReturnType<typeof cpus>;
    totalmem: () => number;
    freemem: () => number;
  };

  constructor(config: NodeResourceConfig, callbacks: NodeResourceCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.startTime = Date.now();
    this.osFns = { cpus, totalmem, freemem };
  }

  snapshot(): ResourceSnapshot {
    const cpuInfo = this.osFns.cpus();
    const totalMemBytes = this.osFns.totalmem();
    const freeMemBytes = this.osFns.freemem();

    // Compute a rough CPU load from the average idle percentage
    let cpuLoadPercent = 0;
    if (cpuInfo.length > 0) {
      const totalIdle = cpuInfo.reduce((sum, c) => sum + c.times.idle, 0);
      const totalTick = cpuInfo.reduce(
        (sum, c) => sum + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
        0,
      );
      if (totalTick > 0) {
        cpuLoadPercent = Math.round((1 - totalIdle / totalTick) * 100);
      }
    }

    return {
      nodeId: this.config.nodeId,
      instanceName: this.config.instanceName,
      cpuCount: cpuInfo.length || 1,
      cpuLoadPercent,
      memoryTotalMb: Math.round(totalMemBytes / (1024 * 1024)),
      memoryAvailableMb: Math.round(freeMemBytes / (1024 * 1024)),
      sessionsActive: this.callbacks.getActiveSessions(),
      sessionsMax: this.config.sessionsMax,
      projectCount: this.callbacks.getProjectCount(),
      uptimeMs: Date.now() - this.startTime,
      version: this.config.version,
    };
  }
}
