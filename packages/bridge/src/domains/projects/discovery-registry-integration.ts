/**
 * F-THANE-2: Discovery-Registry Integration Service
 *
 * Bridges DiscoveryService (finds projects) with ProjectRegistry (loads configs)
 * - On discovery, loads manifest.yaml from each project
 * - Validates project configs
 * - Registers configs in the registry
 * - Emits CONFIG_DISCOVERED events
 */

import { join } from 'node:path';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';
import type { ProjectRegistry, ProjectConfig } from '../registry/index.js';
import { DiscoveryService, type ProjectMetadata, type DiscoveryResult } from './discovery-service.js';

// PRD 024 MG-1/MG-2: Module-level ports
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure ports for discovery-registry-integration. Called from composition root. */
export function setDiscoveryRegistryPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

function getFs(): FileSystemProvider {
  if (!_fs) _fs = new NodeFileSystemProvider();
  return _fs;
}
function getYaml(): YamlLoader {
  if (!_yaml) _yaml = new JsYamlLoader();
  return _yaml;
}

export interface DiscoveryWithRegistryResult extends DiscoveryResult {
  configs_loaded: number;
  configs_failed: number;
}

/**
 * Load and validate project config from .method/project-config.yaml
 */
export function loadProjectConfig(projectPath: string, projectId: string): ProjectConfig | null {
  try {
    const configPath = join(projectPath, '.method', 'project-config.yaml');
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
      return configData as ProjectConfig;
    }

    console.warn(`[DiscoveryRegistry] Project ${projectId}: config missing required fields (id, name)`);
    return null;
  } catch (err) {
    console.warn(`[DiscoveryRegistry] Project ${projectId}: failed to load config:`, (err as Error).message);
    return null;
  }
}

/**
 * Discover projects and register their configs in the registry
 * F-THANE-2: Ensures discovered projects have configs loaded
 */
export async function discoverAndRegister(
  discoveryService: DiscoveryService,
  registry: ProjectRegistry,
  rootDir: string,
): Promise<DiscoveryWithRegistryResult> {
  // Run discovery
  const discoveryResult = await discoveryService.discover(rootDir);

  let configsLoaded = 0;
  let configsFailed = 0;

  // For each discovered project, try to load and register its config
  for (const project of discoveryResult.projects) {
    // Skip projects with configuration issues
    if (!project.git_valid) {
      configsFailed++;
      continue;
    }

    // Try to load project config
    const config = loadProjectConfig(project.path, project.id);

    if (config) {
      try {
        registry.registerProjectConfig(config);
        configsLoaded++;
      } catch (err) {
        console.warn(`[DiscoveryRegistry] Failed to register config for ${project.id}:`, (err as Error).message);
        configsFailed++;
      }
    } else {
      // Config not found or invalid
      configsFailed++;
    }
  }

  return {
    ...discoveryResult,
    configs_loaded: configsLoaded,
    configs_failed: configsFailed,
  };
}

/**
 * Rescan and reload all discovered projects' configs
 * F-THANE-2: Updates registry.rescan() to also reload project configs
 */
export async function rescanAndReloadConfigs(
  discoveryService: DiscoveryService,
  registry: ProjectRegistry,
  rootDir: string,
): Promise<DiscoveryWithRegistryResult> {
  // Rescan to get fresh project list
  const discoveryResult = await discoveryService.discover(rootDir);

  let configsLoaded = 0;
  let configsFailed = 0;

  // Reload configs for each project
  for (const project of discoveryResult.projects) {
    if (!project.git_valid) {
      configsFailed++;
      continue;
    }

    const config = loadProjectConfig(project.path, project.id);
    if (config) {
      try {
        registry.registerProjectConfig(config);
        configsLoaded++;
      } catch (err) {
        console.warn(`[DiscoveryRegistry] Failed to register config for ${project.id} on rescan:`, (err as Error).message);
        configsFailed++;
      }
    } else {
      configsFailed++;
    }
  }

  return {
    ...discoveryResult,
    configs_loaded: configsLoaded,
    configs_failed: configsFailed,
  };
}
