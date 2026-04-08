/**
 * FcaDetector — Detects which FCA parts are present in a component directory.
 *
 * Part detection rules (first matching rule wins for each file):
 *   documentation  : README.md, *.md (excluding *.test.ts, *.spec.ts patterns)
 *   interface      : index.ts with export keywords
 *   port           : ports/**​/*.ts, *port.ts, *.port.ts, *-port.ts
 *   verification   : *.test.ts, *.spec.ts, *.contract.test.ts, architecture.test.ts
 *   observability  : *.metrics.ts, *.observability.ts, observability/**
 *   architecture   : architecture.ts, architecture.test.ts, arch/**
 *   domain         : domain/**, *-domain.ts
 *   boundary       : any TS file in a subdirectory (directory presence)
 */

import type { FileSystemPort } from '../ports/internal/file-system.js';
import type { FcaPart, ComponentPart } from '../ports/context-query.js';
import { DocExtractor } from './doc-extractor.js';

export interface FcaDetectorConfig {
  requiredParts?: FcaPart[];
}

export class FcaDetector {
  private readonly extractor: DocExtractor;

  constructor(private readonly fs: FileSystemPort) {
    this.extractor = new DocExtractor(fs);
  }

  /**
   * Detect FCA parts present in componentDir.
   * Returns ComponentPart[] — only parts that are actually found.
   */
  async detect(componentDir: string, _config: FcaDetectorConfig): Promise<ComponentPart[]> {
    const entries = await this.safeReadDir(componentDir);
    const detectedParts: ComponentPart[] = [];
    const assignedParts = new Set<FcaPart>();

    // We iterate all entries; for each file we determine which part it satisfies
    for (const entry of entries) {
      if (entry.isDirectory) {
        // Check subdirectory-based parts: ports/, observability/, arch/, domain/
        const dirPart = this.classifySubDir(entry.name);
        if (dirPart && !assignedParts.has(dirPart)) {
          // Find first TS file in the subdir for the filepath
          const subFiles = await this.safeReadDir(entry.path);
          const firstTs = subFiles.find(e => !e.isDirectory && e.name.endsWith('.ts'));
          if (firstTs) {
            const excerpt = await this.safeExtract(firstTs.path, dirPart);
            detectedParts.push({ part: dirPart, filePath: firstTs.path, excerpt });
            assignedParts.add(dirPart);
          }
        }
        // Check boundary: any subdirectory with TS files counts
        if (!assignedParts.has('boundary')) {
          const subFiles = await this.safeReadDir(entry.path);
          const hasTsFiles = subFiles.some(e => !e.isDirectory && e.name.endsWith('.ts'));
          if (hasTsFiles) {
            const firstTs = subFiles.find(e => !e.isDirectory && e.name.endsWith('.ts'))!;
            const excerpt = await this.safeExtract(firstTs.path, 'boundary');
            detectedParts.push({ part: 'boundary', filePath: firstTs.path, excerpt });
            assignedParts.add('boundary');
          }
        }
      } else {
        // File-based detection
        const part = await this.classifyFile(entry.name, entry.path);
        if (part && !assignedParts.has(part)) {
          const excerpt = await this.safeExtract(entry.path, part);
          detectedParts.push({ part, filePath: entry.path, excerpt });
          assignedParts.add(part);
        }
      }
    }

    return detectedParts;
  }

  private async classifyFile(name: string, filePath: string): Promise<FcaPart | null> {
    // Rule order matters — first matching rule wins

    // documentation: README.md or *.md (not test files)
    if (name === 'README.md' || (name.endsWith('.md') && !name.endsWith('.test.md'))) {
      return 'documentation';
    }

    // verification: *.test.ts, *.spec.ts, *.contract.test.ts, architecture.test.ts
    if (
      name.endsWith('.test.ts') ||
      name.endsWith('.spec.ts') ||
      name.endsWith('.contract.test.ts')
    ) {
      return 'verification';
    }

    // architecture: architecture.ts
    if (name === 'architecture.ts') {
      return 'architecture';
    }

    // observability: *.metrics.ts, *.observability.ts
    if (name.endsWith('.metrics.ts') || name.endsWith('.observability.ts')) {
      return 'observability';
    }

    // port: *port.ts, *.port.ts, *-port.ts
    if (
      name.endsWith('port.ts') ||
      name.endsWith('.port.ts') ||
      name.endsWith('-port.ts') ||
      /port\.ts$/.test(name)
    ) {
      return 'port';
    }

    // domain: *-domain.ts
    if (name.endsWith('-domain.ts')) {
      return 'domain';
    }

    // interface: index.ts with export keywords
    if (name === 'index.ts') {
      const content = await this.fs.readFile(filePath, 'utf-8');
      if (/\bexport\b/.test(content)) {
        return 'interface';
      }
    }

    return null;
  }

  private classifySubDir(dirName: string): FcaPart | null {
    if (dirName === 'ports') return 'port';
    if (dirName === 'observability') return 'observability';
    if (dirName === 'arch') return 'architecture';
    if (dirName === 'domain') return 'domain';
    return null;
  }

  private async safeReadDir(dir: string) {
    try {
      return await this.fs.readDir(dir);
    } catch {
      return [];
    }
  }

  private async safeExtract(filePath: string, part: FcaPart): Promise<string> {
    try {
      return await this.extractor.extract(filePath, part);
    } catch {
      return '';
    }
  }
}
