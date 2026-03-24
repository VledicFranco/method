/**
 * PRD-020: Project Isolation Layer — ProjectRegistry
 *
 * In-memory, queryable registry of compiled methodology YAML specs.
 * Loads from registry/ directory, caches, validates.
 *
 * F-THANE-2: Also tracks discovered projects and their configurations
 *
 * PRD 024 MG-1/MG-2: Uses FileSystemProvider and YamlLoader ports
 * instead of direct fs/js-yaml imports.
 */

import path from 'path';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';

export interface MethodologySpec {
  id: string;
  name: string;
  version: string;
  description?: string;
  [key: string]: any;
}

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  version?: string;
  dependencies?: Array<{ project_id: string; version_constraint?: string }>;
  shared_with?: string[];
  genesis_enabled?: boolean;
  resource_copy?: boolean;
  genesis_budget?: number;
  [key: string]: any;
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProjectRegistry {
  /**
   * Initialize registry — scan and load all YAML specs
   */
  initialize(): Promise<void>;

  /**
   * Rescan registry — reload all YAML specs from disk
   */
  rescan(): Promise<void>;

  /**
   * Find spec by name (exact match)
   */
  find(name: string): MethodologySpec | undefined;

  /**
   * List all loaded specs
   */
  list(): MethodologySpec[];

  /**
   * Get spec by name (alias for find)
   */
  getByName(name: string): MethodologySpec | undefined;

  /**
   * Verify a spec is valid
   */
  verify(spec: MethodologySpec): VerifyResult;

  /**
   * F-THANE-2: Register a discovered project config
   */
  registerProjectConfig(config: ProjectConfig): void;

  /**
   * F-THANE-2: Get a registered project config by ID
   */
  getProjectConfig(projectId: string): ProjectConfig | undefined;

  /**
   * F-THANE-2: List all registered project configs
   */
  listProjectConfigs(): ProjectConfig[];
}

/**
 * In-memory ProjectRegistry implementation
 *
 * PRD 024: Accepts optional fs/yaml ports for dependency injection.
 * When not provided, falls back to module-level ports (for backward compat with tests).
 */
export class InMemoryProjectRegistry implements ProjectRegistry {
  private specs: Map<string, MethodologySpec> = new Map();
  private projectConfigs: Map<string, ProjectConfig> = new Map();
  private initialized = false;
  private registryDir: string;
  private fs?: FileSystemProvider;
  private yaml?: YamlLoader;

  constructor(
    registryDir: string = path.join(process.cwd(), 'registry'),
    deps?: { fs: FileSystemProvider; yaml: YamlLoader },
  ) {
    this.registryDir = registryDir;
    this.fs = deps?.fs;
    this.yaml = deps?.yaml;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Scan registry directory for YAML files
    const specs = await this.scanRegistryDirectory(this.registryDir);
    specs.forEach((spec) => {
      this.specs.set(spec.id, spec);
      if (spec.name) {
        this.specs.set(spec.name, spec);
      }
    });

    this.initialized = true;
  }

  async rescan(): Promise<void> {
    // Clear existing specs
    this.specs.clear();

    // Scan registry directory for YAML files
    const specs = await this.scanRegistryDirectory(this.registryDir);
    specs.forEach((spec) => {
      this.specs.set(spec.id, spec);
      if (spec.name) {
        this.specs.set(spec.name, spec);
      }
    });

    this.initialized = true;
  }

  find(name: string): MethodologySpec | undefined {
    if (!this.initialized) {
      throw new Error('Registry not initialized. Call initialize() first.');
    }
    return this.specs.get(name);
  }

  list(): MethodologySpec[] {
    if (!this.initialized) {
      throw new Error('Registry not initialized. Call initialize() first.');
    }
    // Return unique specs (avoid duplicates from id and name keys)
    const seen = new Set<string>();
    const result: MethodologySpec[] = [];

    for (const spec of this.specs.values()) {
      if (!seen.has(spec.id)) {
        seen.add(spec.id);
        result.push(spec);
      }
    }

    return result;
  }

  getByName(name: string): MethodologySpec | undefined {
    return this.find(name);
  }

  verify(spec: MethodologySpec): VerifyResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!spec.id || typeof spec.id !== 'string') {
      errors.push('Missing or invalid field: id');
    }
    if (!spec.name || typeof spec.name !== 'string') {
      errors.push('Missing or invalid field: name');
    }
    if (!spec.version || typeof spec.version !== 'string') {
      errors.push('Missing or invalid field: version');
    }

    // Version format check
    if (spec.version && !this.isValidVersion(spec.version)) {
      warnings.push(`Version "${spec.version}" does not follow semantic versioning`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * F-THANE-2: Register a discovered project config
   */
  registerProjectConfig(config: ProjectConfig): void {
    if (!config.id) {
      throw new Error('Project config must have an id');
    }
    this.projectConfigs.set(config.id, config);
  }

  /**
   * F-THANE-2: Get a registered project config by ID
   */
  getProjectConfig(projectId: string): ProjectConfig | undefined {
    return this.projectConfigs.get(projectId);
  }

  /**
   * F-THANE-2: List all registered project configs
   */
  listProjectConfigs(): ProjectConfig[] {
    return Array.from(this.projectConfigs.values());
  }

  private async scanRegistryDirectory(dir: string): Promise<MethodologySpec[]> {
    const specs: MethodologySpec[] = [];

    // Use port if available, else skip scan (tests that don't provide ports)
    if (!this.fs) {
      return specs;
    }

    if (!this.fs.existsSync(dir)) {
      return specs; // No registry directory yet
    }

    const entries = this.fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subSpecs = await this.scanRegistryDirectory(fullPath);
        specs.push(...subSpecs);
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        try {
          const content = this.fs.readFileSync(fullPath, 'utf-8');
          const parsed = this.yaml ? this.yaml.load(content) : null;

          // Extract spec from parsed YAML
          // Support both direct spec and wrapped in a "spec" key
          let spec = parsed;
          if (parsed && typeof parsed === 'object' && 'spec' in parsed) {
            spec = (parsed as any).spec;
          }

          if (this.isValidSpec(spec)) {
            specs.push(spec as MethodologySpec);
          }
        } catch (err) {
          // Log but don't throw — allow partial registry loads
          console.warn(`Failed to load ${fullPath}:`, (err as Error).message);
        }
      }
    }

    return specs;
  }

  private isValidSpec(spec: any): boolean {
    return (
      spec &&
      typeof spec === 'object' &&
      typeof spec.id === 'string' &&
      typeof spec.name === 'string' &&
      typeof spec.version === 'string'
    );
  }

  private isValidVersion(version: string): boolean {
    // Simple semver check: X.Y.Z
    return /^\d+\.\d+\.\d+/.test(version);
  }
}
