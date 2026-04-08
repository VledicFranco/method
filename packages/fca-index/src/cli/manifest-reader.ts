/**
 * DefaultManifestReader — ManifestReaderPort implementation.
 *
 * Reads `.fca-index.yaml` at project root if present; falls back to defaults.
 * Uses a minimal YAML parser for flat key:value pairs only — no external YAML
 * library required (avoids adding deps to package.json).
 *
 * Parse errors are silently swallowed — a missing or malformed config simply
 * returns the default ProjectScanConfig.
 */

import type { ManifestReaderPort, ProjectScanConfig } from '../ports/manifest-reader.js';
import type { FileSystemPort } from '../ports/internal/file-system.js';

export class DefaultManifestReader implements ManifestReaderPort {
  constructor(private readonly fs: FileSystemPort) {}

  async read(projectRoot: string): Promise<ProjectScanConfig> {
    const configPath = `${projectRoot}/.fca-index.yaml`;
    const exists = await this.fs.exists(configPath);

    if (!exists) {
      return { projectRoot };
    }

    try {
      const content = await this.fs.readFile(configPath, 'utf-8');
      return { projectRoot, ...this.parseConfig(content) };
    } catch {
      return { projectRoot };
    }
  }

  private parseConfig(yaml: string): Partial<ProjectScanConfig> {
    const result: Partial<ProjectScanConfig> = {};

    for (const line of yaml.split('\n')) {
      // Match simple key: value lines (no nested objects or arrays)
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (!match) continue;

      const [, key, raw] = match;
      const value = raw.trim();

      switch (key) {
        case 'coverageThreshold': {
          const n = parseFloat(value);
          if (!isNaN(n)) result.coverageThreshold = n;
          break;
        }
        case 'embeddingModel':
          result.embeddingModel = value;
          break;
        case 'embeddingDimensions': {
          const n = parseInt(value, 10);
          if (!isNaN(n)) result.embeddingDimensions = n;
          break;
        }
        case 'indexDir':
          result.indexDir = value;
          break;
      }
    }

    return result;
  }
}
