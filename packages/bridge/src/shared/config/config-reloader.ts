/**
 * Config Reloader — Atomic config reload with validation and audit logging
 *
 * Handles:
 * - Atomic writes (temp file + atomic rename) to prevent TOCTOU races
 * - YAML validation before writing
 * - Audit logging of all changes (timestamp, user, diffs)
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import yaml from 'js-yaml';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Zod schema for manifest.yaml structure
 * Used for validation when manifest key is present
 */
const InstalledEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['methodology', 'protocol', 'strategy']),
  version: z.string(),
  card: z.string().optional(),
  card_version: z.string().optional(),
  instance_id: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  note: z.string().optional(),
  status: z.enum(['draft', 'promoted', 'active']).optional(),
  extends: z.string().optional(),
});

const ManifestSchema = z.object({
  manifest: z.object({
    project: z.string(),
    last_updated: z.string(),
    installed: z.array(InstalledEntrySchema),
  }),
});

/**
 * Config validation: either a manifest config or a generic object
 * If it has 'manifest' key, validate as ManifestSchema
 * Otherwise, accept any non-null object
 */
const ConfigSchema = z.union([
  ManifestSchema,
  z.object({}).passthrough(), // Accept any other object
]);

export interface ConfigReloadRequest {
  configPath: string;
  newConfig: Record<string, any>;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface ConfigReloadResult {
  success: boolean;
  message: string;
  oldConfig?: Record<string, any>;
  newConfig?: Record<string, any>;
  diff?: string;
  error?: string;
}

/**
 * Validates YAML config structure using Zod schema
 * - If config has 'manifest' key, validates against ManifestSchema
 * - Otherwise, accepts any non-null object
 */
export function validateConfig(config: Record<string, any>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Basic structure check
  if (typeof config !== 'object' || config === null) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  // If config has a 'manifest' key, validate it strictly as ManifestSchema
  if ('manifest' in config) {
    try {
      ManifestSchema.parse(config);
    } catch (err) {
      if (err instanceof z.ZodError) {
        err.issues.forEach((error) => {
          const path = error.path.join('.');
          errors.push(`${path || 'root'}: ${error.message}`);
        });
      } else {
        errors.push((err as Error).message);
      }
    }
  }
  // Otherwise, accept any object (for backward compatibility with tests and other use cases)

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generates a simple diff between old and new config
 */
function generateDiff(oldConfig: Record<string, any>, newConfig: Record<string, any>): string {
  const diffs: string[] = [];

  // Check for added/changed keys
  for (const key in newConfig) {
    if (!(key in oldConfig)) {
      diffs.push(`+ ${key}: ${JSON.stringify(newConfig[key])}`);
    } else if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
      diffs.push(`~ ${key}: ${JSON.stringify(oldConfig[key])} → ${JSON.stringify(newConfig[key])}`);
    }
  }

  // Check for removed keys
  for (const key in oldConfig) {
    if (!(key in newConfig)) {
      diffs.push(`- ${key}: ${JSON.stringify(oldConfig[key])}`);
    }
  }

  return diffs.join('\n');
}

/**
 * Loads existing config from file
 */
export async function loadConfig(configPath: string): Promise<Record<string, any>> {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = yaml.load(content);
    if (typeof config !== 'object' || config === null) {
      throw new Error('Config is not an object');
    }
    return config as Record<string, any>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}; // File doesn't exist, return empty config
    }
    throw err;
  }
}

/**
 * Performs atomic config reload with audit logging
 */
export async function reloadConfig(request: ConfigReloadRequest): Promise<ConfigReloadResult> {
  const { configPath, newConfig, userId = 'system', metadata = {} } = request;

  try {
    // Validate new config
    const validation = validateConfig(newConfig);
    if (!validation.valid) {
      return {
        success: false,
        message: 'Config validation failed',
        error: validation.errors.join('; '),
      };
    }

    // Load existing config
    let oldConfig: Record<string, any> = {};
    const configDir = dirname(configPath);
    const configName = basename(configPath);

    if (existsSync(configPath)) {
      oldConfig = await loadConfig(configPath);
    } else {
      // Ensure directory exists
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
    }

    // Generate diff
    const diff = generateDiff(oldConfig, newConfig);

    // Write to temp file (atomic)
    const tempFilePath = join(configDir, `.${configName}.tmp.${randomBytes(4).toString('hex')}`);

    try {
      const newConfigYaml = yaml.dump(newConfig, { indent: 2 });
      writeFileSync(tempFilePath, newConfigYaml, 'utf-8');

      // Atomic rename
      renameSync(tempFilePath, configPath);

      // Audit log
      const timestamp = new Date().toISOString();
      const auditMessage = `[AUDIT] Config reload at ${timestamp}\n` +
        `  User: ${userId}\n` +
        `  File: ${configPath}\n` +
        `  Metadata: ${JSON.stringify(metadata)}\n` +
        `  Changes:\n${diff.split('\n').map((l) => `    ${l}`).join('\n')}\n`;

      console.log(auditMessage);

      return {
        success: true,
        message: 'Config reloaded successfully',
        oldConfig,
        newConfig,
        diff,
      };
    } catch (tempErr) {
      // Clean up temp file if rename failed
      if (existsSync(tempFilePath)) {
        try {
          unlinkSync(tempFilePath);
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
      }
      throw tempErr;
    }
  } catch (err) {
    const errorMsg = (err as Error).message;
    return {
      success: false,
      message: 'Config reload failed',
      error: errorMsg,
    };
  }
}
