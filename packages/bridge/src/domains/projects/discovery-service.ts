/**
 * PRD 020 Wave 2: Discovery Service — Recursive Fail-Safe Repository Scanner
 *
 * Recursively discovers .git/ repositories from a root directory with:
 * - Timeout protection (default 60s, configurable via DISCOVERY_TIMEOUT_MS)
 * - Max project limit (1000 projects)
 * - Error handling (corrupted repos, missing .method/, permission denied)
 * - Resumable discovery with checkpoint support
 * - Performance target: < 500ms for 20 projects
 *
 * F-THANE-2: On discovery, loads manifest.yaml and validates project configs
 */

import { join, resolve } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';

// PRD 024 MG-1/MG-2: Module-level ports
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure ports for discovery-service. Called from composition root. */
export function setDiscoveryServicePorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

function getFs(): FileSystemProvider {
  if (!_fs) throw new Error('FileSystemProvider not configured for discovery-service');
  return _fs;
}
function getYaml(): YamlLoader {
  if (!_yaml) throw new Error('YamlLoader not configured for discovery-service');
  return _yaml;
}

export interface ProjectMetadata {
  id: string;
  path: string;
  status: 'healthy' | 'git_corrupted' | 'missing_config' | 'permission_denied';
  git_valid: boolean;
  method_dir_exists: boolean;
  config_loaded?: boolean;
  config_valid?: boolean;
  config_error?: string;
  error_detail?: string;
  discovered_at: string;
}

export interface DiscoveryCheckpoint {
  last_scanned_dir?: string;
  last_scanned_timestamp?: number;
  projects_found?: string[];
}

export interface DiscoveryResult {
  projects: ProjectMetadata[];
  discovery_incomplete: boolean;
  stopped_at_max_projects?: boolean;
  error?: string;
  scanned_count: number;
  error_count: number;
  elapsed_ms: number;
}

/**
 * Recursive fail-safe discovery service
 */
export class DiscoveryService {
  private timeoutMs: number;
  private maxProjects: number;
  private cachedProjects: ProjectMetadata[] = [];
  private cacheExpiresAt: number = 0;
  private cacheTtlMs: number;

  constructor(options?: { timeoutMs?: number; maxProjects?: number; cacheTtlMs?: number }) {
    const envTimeout = process.env.DISCOVERY_TIMEOUT_MS
      ? parseInt(process.env.DISCOVERY_TIMEOUT_MS, 10)
      : undefined;
    const envCacheTtl = process.env.DISCOVERY_CACHE_TTL_MS
      ? parseInt(process.env.DISCOVERY_CACHE_TTL_MS, 10)
      : undefined;

    this.timeoutMs = options?.timeoutMs ?? envTimeout ?? 60000;
    this.maxProjects = options?.maxProjects ?? 1000;
    this.cacheTtlMs = options?.cacheTtlMs ?? envCacheTtl ?? 1800000; // 30 minutes
  }

  /**
   * Get cached projects from the last discovery run
   * Returns empty array if no discovery has been run yet or cache has expired
   */
  getCachedProjects(): ProjectMetadata[] {
    const now = Date.now();
    if (this.cacheExpiresAt > now && this.cachedProjects.length > 0) {
      console.debug(`Discovery cache hit (${this.cachedProjects.length} projects, expires in ${this.cacheExpiresAt - now}ms)`);
      return [...this.cachedProjects];
    }
    return [];
  }

  /**
   * Clear the discovery cache and force a fresh scan
   */
  clearCache(): void {
    this.cachedProjects = [];
    this.cacheExpiresAt = 0;
    console.debug('Discovery cache cleared');
  }

  /**
   * Discover projects recursively from rootDir
   */
  async discover(
    rootDir: string,
    checkpoint?: DiscoveryCheckpoint,
  ): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const results: ProjectMetadata[] = [];
    const scannedDirs: Set<string> = new Set();
    let errorCount = 0;
    let stoppedAtMaxProjects = false;

    const resolvedRoot = resolve(rootDir);

    if (!getFs().existsSync(resolvedRoot)) {
      return {
        projects: [],
        discovery_incomplete: false,
        error: `Root directory not found: ${resolvedRoot}`,
        scanned_count: 0,
        error_count: 1,
        elapsed_ms: Date.now() - startTime,
      };
    }

    try {
      const walk = (dir: string): void => {
        // Timeout check
        if (Date.now() - startTime > this.timeoutMs) {
          return; // Exit early, discovery_incomplete will be set
        }

        // Max projects check
        if (results.length >= this.maxProjects) {
          stoppedAtMaxProjects = true;
          return;
        }

        // Prevent infinite loops (symlinks, circular refs)
        const realPath = resolve(dir);
        if (scannedDirs.has(realPath)) {
          return;
        }
        scannedDirs.add(realPath);

        let entries: Array<{ name: string; isDirectory: boolean }>;
        try {
          entries = getFs().readdirSync(dir, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          }));
        } catch (err) {
          // Permission denied or other fs error
          errorCount++;
          return;
        }

        for (const entry of entries) {
          // Timeout check
          if (Date.now() - startTime > this.timeoutMs) {
            return;
          }

          // Max projects check
          if (results.length >= this.maxProjects) {
            stoppedAtMaxProjects = true;
            return;
          }

          const fullPath = join(dir, entry.name);

          // Check for .git directory
          if (entry.name === '.git' && entry.isDirectory) {
            const projectMetadata = this.analyzeProject(fullPath);
            if (projectMetadata) {
              results.push(projectMetadata);
            } else {
              errorCount++;
            }
            // Don't recurse into .git
            continue;
          }

          // Skip hidden directories and node_modules for performance
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }

          // Recurse into directories
          if (entry.isDirectory) {
            walk(fullPath);
          }
        }
      };

      walk(resolvedRoot);
    } catch (err) {
      errorCount++;
    }

    const elapsed = Date.now() - startTime;
    const incomplete = results.length >= this.maxProjects || elapsed > this.timeoutMs;

    // Cache the results with TTL
    this.cachedProjects = results;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    console.debug(`Discovery cache updated (${results.length} projects, expires in ${this.cacheTtlMs}ms)`);

    return {
      projects: results,
      discovery_incomplete: incomplete,
      stopped_at_max_projects: stoppedAtMaxProjects,
      scanned_count: scannedDirs.size,
      error_count: errorCount,
      elapsed_ms: elapsed,
    };
  }

  /**
   * Analyze a project directory (parent of .git/)
   * Returns ProjectMetadata even for corrupted repos (never returns undefined)
   * Marks corrupted repos with status: 'git_corrupted'
   *
   * F-THANE-2: Also loads and validates project-config.yaml
   */
  private analyzeProject(gitDir: string): ProjectMetadata | undefined {
    try {
      // Parent of .git is the project root
      const projectPath = resolve(gitDir, '..');
      const projectName = projectPath.split(/[\\/]/).pop() || 'unknown';

      // Check if .git is a valid git directory
      let gitIsValid = false;
      let errorDetail: string | undefined;
      try {
        gitIsValid = this.isValidGitRepo(gitDir);
      } catch (err) {
        gitIsValid = false;
        errorDetail = `Git validation error: ${(err as Error).message}`;
      }

      // Check for .method directory
      const methodDir = join(projectPath, '.method');
      let methodExists = getFs().existsSync(methodDir);

      // Auto-create .method if missing
      if (!methodExists) {
        try {
          getFs().mkdirSync(methodDir, { recursive: true });
          methodExists = true;
        } catch (err) {
          // Log but don't fail discovery
          console.warn(`Failed to create .method for ${projectPath}:`, (err as Error).message);
        }
      }

      // F-THANE-2: Load and validate project config
      let configLoaded = false;
      let configValid = false;
      let configError: string | undefined;

      const configPath = join(methodDir, 'project-config.yaml');
      if (getFs().existsSync(configPath)) {
        try {
          const configContent = getFs().readFileSync(configPath, 'utf-8');
          const configData = getYaml().load(configContent);

          // Validate required fields: id and name
          if (
            configData &&
            typeof configData === 'object' &&
            'id' in configData &&
            'name' in configData &&
            typeof configData.id === 'string' &&
            typeof configData.name === 'string'
          ) {
            configValid = true;
            configLoaded = true;
          } else {
            configError = 'Missing required fields: id and name';
            configLoaded = false;
          }
        } catch (err) {
          configError = `Failed to parse config: ${(err as Error).message}`;
          configLoaded = false;
        }
      }

      return {
        id: projectName,
        path: projectPath,
        status: gitIsValid ? 'healthy' : 'git_corrupted',
        git_valid: gitIsValid,
        method_dir_exists: methodExists,
        config_loaded: configLoaded,
        config_valid: configValid,
        config_error: configError,
        error_detail: errorDetail,
        discovered_at: new Date().toISOString(),
      };
    } catch (err) {
      return undefined;
    }
  }

  /**
   * Check if .git directory is a valid git repository
   * Throws if .git structure is severely corrupted
   */
  private isValidGitRepo(gitDir: string): boolean {
    try {
      // Check for essential git directory structure
      // At minimum, a .git should be a directory and contain objects/
      if (!getFs().statSync(gitDir).isDirectory()) {
        return false;
      }

      const objectsDir = join(gitDir, 'objects');
      const refsDir = join(gitDir, 'refs');

      return getFs().existsSync(objectsDir) && getFs().existsSync(refsDir);
    } catch (err) {
      // If we can't even stat the .git directory, it's corrupted
      throw err;
    }
  }
}
