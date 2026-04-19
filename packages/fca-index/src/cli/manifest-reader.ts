// SPDX-License-Identifier: Apache-2.0
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
import type { FcaPart } from '../ports/context-query.js';

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
    let currentArrayKey: 'sourcePatterns' | 'excludePatterns' | 'requiredParts' | null = null;

    for (const line of yaml.split('\n')) {
      // YAML list item — must check first to preserve array collection state
      const listMatch = line.match(/^\s+-\s+(.+)$/);
      if (listMatch && currentArrayKey) {
        const value = listMatch[1].trim();
        if (currentArrayKey === 'sourcePatterns') {
          (result.sourcePatterns ??= []).push(value);
        } else if (currentArrayKey === 'excludePatterns') {
          (result.excludePatterns ??= []).push(value);
        } else if (currentArrayKey === 'requiredParts') {
          (result.requiredParts ??= []).push(value as FcaPart);
        }
        continue;
      }

      // Any non-list line ends the current array block
      currentArrayKey = null;

      // Scalar key: value line
      const scalarMatch = line.match(/^(\w+):\s*(.+)$/);
      if (scalarMatch) {
        const [, key, raw] = scalarMatch;
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
        continue;
      }

      // Array header — key with no value (e.g. "sourcePatterns:")
      const arrayKeyMatch = line.match(/^(\w+):\s*$/);
      if (arrayKeyMatch) {
        const key = arrayKeyMatch[1];
        if (key === 'sourcePatterns' || key === 'excludePatterns' || key === 'requiredParts') {
          currentArrayKey = key;
        }
      }
    }

    return result;
  }
}
