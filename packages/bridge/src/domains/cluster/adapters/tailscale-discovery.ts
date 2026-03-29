// ── Tailscale Discovery Adapter ─────────────────────────────────
//
// DiscoveryProvider implementation that uses the Tailscale CLI
// (`tailscale status --json`) to find peer bridge instances.
// Falls back to CLUSTER_SEEDS when Tailscale is unavailable.
//
// Cross-platform: works on Windows, macOS, and Linux via the
// `tailscale` CLI which is available on all platforms.

import { execFile } from 'node:child_process';
import type { DiscoveryProvider } from '@method/cluster';
import type { PeerAddress, NodeIdentity } from '@method/cluster';

// ── Tailscale Status Response (subset) ────────────────────────

interface TailscaleStatus {
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
  Peer?: Record<string, {
    DNSName?: string;
    HostName?: string;
    TailscaleIPs?: string[];
    Online?: boolean;
  }>;
}

// ── Logger Interface ──────────────────────────────────────────

export interface TailscaleDiscoveryLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

// ── Config ────────────────────────────────────────────────────

export interface TailscaleDiscoveryConfig {
  /** Port to probe peers on (default bridge port). */
  bridgePort: number;
  /** Comma-separated seed addresses as fallback. */
  seeds: string;
  /** Timeout for health probes in milliseconds. */
  probeTimeoutMs?: number;
}

// ── Exec Helper (overridable for testing) ─────────────────────

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

// ── Fetch Helper (overridable for testing) ─────────────────────

export type ProbeFn = (url: string, timeoutMs: number) => Promise<boolean>;

const defaultProbe: ProbeFn = async (url, timeoutMs) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

// ── Implementation ────────────────────────────────────────────

export class TailscaleDiscovery implements DiscoveryProvider {
  private readonly config: TailscaleDiscoveryConfig;
  private readonly logger: TailscaleDiscoveryLogger;
  private readonly exec: ExecFn;
  private readonly probe: ProbeFn;

  constructor(
    config: TailscaleDiscoveryConfig,
    logger: TailscaleDiscoveryLogger,
    overrides?: { exec?: ExecFn; probe?: ProbeFn },
  ) {
    this.config = config;
    this.logger = logger;
    this.exec = overrides?.exec ?? defaultExec;
    this.probe = overrides?.probe ?? defaultProbe;
  }

  async discover(): Promise<PeerAddress[]> {
    try {
      return await this.discoverViaTailscale();
    } catch {
      this.logger.warn('[tailscale-discovery] Tailscale API unavailable, falling back to seeds');
      return this.discoverViaSeeds();
    }
  }

  async announce(_self: NodeIdentity): Promise<void> {
    // Tailscale handles advertising automatically via MagicDNS.
    // No explicit announce needed — peers discover each other via `tailscale status`.
  }

  // ── Internal ──────────────────────────────────────────────────

  private async discoverViaTailscale(): Promise<PeerAddress[]> {
    const stdout = await this.exec('tailscale', ['status', '--json']);
    const status: TailscaleStatus = JSON.parse(stdout);

    if (!status.Peer) {
      this.logger.info('[tailscale-discovery] No peers found in Tailscale status');
      return [];
    }

    const selfDns = status.Self?.DNSName ?? '';
    const probeTimeout = this.config.probeTimeoutMs ?? 3000;

    // Collect online peers
    const candidates: Array<{ host: string; name: string }> = [];
    for (const [, peer] of Object.entries(status.Peer)) {
      if (!peer.Online) continue;

      // Use the MagicDNS name (without trailing dot) or fallback to IP
      const host = peer.DNSName
        ? peer.DNSName.replace(/\.$/, '')
        : peer.TailscaleIPs?.[0];

      if (!host) continue;
      if (host === selfDns.replace(/\.$/, '')) continue; // skip self

      candidates.push({ host, name: peer.HostName ?? host });
    }

    if (candidates.length === 0) {
      this.logger.info('[tailscale-discovery] No online Tailscale peers found');
      return [];
    }

    // Probe each candidate at the bridge port for a /health endpoint
    const results: PeerAddress[] = [];
    const probes = candidates.map(async (c) => {
      const url = `http://${c.host}:${this.config.bridgePort}/health`;
      const reachable = await this.probe(url, probeTimeout);
      if (reachable) {
        results.push({ host: c.host, port: this.config.bridgePort });
        this.logger.info(`[tailscale-discovery] Found bridge peer: ${c.name} at ${c.host}:${this.config.bridgePort}`);
      }
    });

    await Promise.all(probes);
    return results;
  }

  private discoverViaSeeds(): PeerAddress[] {
    if (!this.config.seeds || this.config.seeds.trim().length === 0) {
      return [];
    }

    return this.config.seeds
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const parts = s.split(':');
        const host = parts[0];
        const port = parts.length > 1 ? parseInt(parts[1], 10) : this.config.bridgePort;
        return { host, port };
      });
  }
}
