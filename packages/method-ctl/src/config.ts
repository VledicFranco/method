// SPDX-License-Identifier: Apache-2.0
// ── method-ctl — Config Management ──────────────────────────────
//
// Reads ~/.method/cluster.json for CLI configuration. Gracefully
// defaults when the file doesn't exist — assumes localhost:3456.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

// ── Schema ────────────────────────────────────────────────────────

const KnownBridgeSchema = z.object({
  name: z.string(),
  address: z.string(),
});

export const CtlConfigSchema = z.object({
  default_bridge: z.string().default('localhost:3456'),
  known_bridges: z.array(KnownBridgeSchema).default([]),
  output_format: z.enum(['table', 'json']).default('table'),
});

export type CtlConfig = z.infer<typeof CtlConfigSchema>;
export type KnownBridge = z.infer<typeof KnownBridgeSchema>;

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: CtlConfig = {
  default_bridge: 'localhost:3456',
  known_bridges: [],
  output_format: 'table',
};

// ── Loader ───────────────────────────────────────────────────────

/**
 * Load config from ~/.method/cluster.json.
 * Returns defaults if the file doesn't exist or is invalid.
 */
export function loadConfig(): CtlConfig {
  const configPath = join(homedir(), '.method', 'cluster.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return CtlConfigSchema.parse(parsed);
  } catch {
    // File doesn't exist, isn't valid JSON, or fails schema validation.
    // All of these fall back to defaults — the CLI should work without config.
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Resolve the bridge address to use for a command.
 * Priority: --bridge flag > config file > default.
 */
export function resolveBridgeAddress(flagValue: string | undefined, config: CtlConfig): string {
  if (flagValue) return flagValue;
  return config.default_bridge;
}

/**
 * Resolve the output format.
 * Priority: --format flag > config file > default.
 */
export function resolveFormat(flagValue: string | undefined, config: CtlConfig): 'table' | 'json' {
  if (flagValue === 'json' || flagValue === 'table') return flagValue;
  return config.output_format;
}
