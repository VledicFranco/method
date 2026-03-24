/**
 * PRD 020 Phase 3: Resource Copier — Copy Methodologies and Strategies
 *
 * Implements resource copying between projects:
 * - resource_copy_methodology: Copy methodology entry from source to target projects
 * - resource_copy_strategy: Copy strategy entry from source to target projects
 *
 * Behavior:
 * - Reads source manifest.yaml
 * - Copies methodology/strategy entry to target manifest.yaml files
 * - Validates targets exist
 * - Handles partial failures gracefully (reports per-target status)
 * - Does not crash on errors
 */

import * as path from 'path';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';

// PRD 024 MG-1/MG-2: Module-level port references, set via setResourceCopierPorts()
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure port providers for resource copier. Called from composition root. */
export function setResourceCopierPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
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

export interface CopyResult {
  project_id: string;
  status: 'success' | 'error';
  error_detail?: string;
}

export interface CopyMethodologyRequest {
  source_id: string;
  method_name: string;
  target_ids: string[];
}

export interface CopyStrategyRequest {
  source_id: string;
  strategy_name: string;
  target_ids: string[];
}

export interface CopyResponse {
  copied_to: CopyResult[];
}

// ── F-S-1: Target IDs Validation ────

/**
 * Validates target_ids array for bounds and format.
 *
 * @param target_ids - Array of 1-100 project IDs in format [a-z0-9_-]{3,64}
 * @returns { valid: boolean; error?: string }
 *
 * Rules:
 * - Min 1 item, max 100 items (bounds)
 * - Each item matches /^[a-z0-9_-]{3,64}$/
 * - Return error string if validation fails
 */
export function validateTargetIds(target_ids: any): { valid: boolean; error?: string } {
  // Check if target_ids is an array
  if (!Array.isArray(target_ids)) {
    return { valid: false, error: 'target_ids must be an array' };
  }

  // Check bounds: min 1, max 100
  if (target_ids.length < 1) {
    return { valid: false, error: 'target_ids must contain at least 1 project ID' };
  }

  if (target_ids.length > 100) {
    return { valid: false, error: 'target_ids must contain at most 100 project IDs' };
  }

  // Validate format of each item: /^[a-z0-9_-]{3,64}$/
  const projectIdRegex = /^[a-z0-9_-]{3,64}$/;
  for (let i = 0; i < target_ids.length; i++) {
    const id = target_ids[i];

    // Check if it's a string
    if (typeof id !== 'string') {
      return { valid: false, error: `target_ids[${i}] must be a string, got ${typeof id}` };
    }

    // Check format
    if (!projectIdRegex.test(id)) {
      return {
        valid: false,
        error: `target_ids[${i}] "${id}" does not match format [a-z0-9_-]{3,64}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Safely resolve project directory path from project ID
 * Includes path traversal protection to prevent directory escape attacks
 *
 * In Phase 1, we assume project ID = project directory name
 * Root is determined by rootDir parameter (default: process.cwd())
 *
 * F-S-7: Path canonicalization — resolves symlinks using fs.realpathSync()
 * and validates that paths remain within the root directory structure.
 */
function resolveProjectPath(projectId: string, rootDir: string = process.cwd()): string {
  const fs = getFs();
  // Special case: root project
  if (projectId === 'root' || projectId === '.') {
    return rootDir;
  }

  let resolvedPath: string;

  // If projectId contains path separators, treat as relative path
  // Otherwise, treat as sibling directory
  if (projectId.includes(path.sep) || projectId.includes('/')) {
    resolvedPath = path.resolve(projectId);
  } else {
    resolvedPath = path.resolve(rootDir, projectId);
  }

  // Path traversal protection: ensure resolved path stays within root
  try {
    const normalizedRoot = path.normalize(path.resolve(rootDir));
    const normalized = path.normalize(path.resolve(resolvedPath));

    // Check if normalized path starts with root (with separator to prevent prefix matches)
    if (!normalized.startsWith(normalizedRoot + path.sep) && normalized !== normalizedRoot) {
      throw new Error(`Path traversal detected: "${projectId}" resolves outside root directory`);
    }

    // F-S-7: Path canonicalization — resolve symlinks if path exists
    let canonicalPath = normalized;
    if (fs.existsSync(normalized)) {
      try {
        canonicalPath = fs.realpathSync(normalized);
        // Verify canonical path still within root
        const canonicalNormalized = path.normalize(canonicalPath);
        if (
          !canonicalNormalized.startsWith(normalizedRoot + path.sep) &&
          canonicalNormalized !== normalizedRoot
        ) {
          throw new Error(
            `Symlink escape detected: "${projectId}" resolves to ${canonicalNormalized} outside root directory`,
          );
        }
      } catch (err) {
        // If realpathSync fails but path exists, use normalized path
        if ((err as Error).message.includes('Symlink escape')) {
          throw err;
        }
        // Otherwise fall through to normalized path
      }
    } else {
      // For non-existent paths (new projects), use normalized + startsWith check as fallback
      canonicalPath = normalized;
    }

    return canonicalPath;
  } catch (err) {
    if (
      (err as Error).message.includes('Path traversal detected') ||
      (err as Error).message.includes('Symlink escape')
    ) {
      throw err;
    }
    throw new Error(`Failed to resolve project path: ${(err as Error).message}`);
  }
}

/**
 * Load manifest.yaml from a project
 * Returns null if file doesn't exist or is invalid
 */
function loadManifest(projectPath: string): any | null {
  const fs = getFs();
  const yaml = getYaml();
  const manifestPath = path.join(projectPath, '.method', 'manifest.yaml');

  try {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = yaml.load(content) as any;
    return manifest;
  } catch (err) {
    console.error(`Failed to load manifest from ${manifestPath}:`, (err as Error).message);
    return null;
  }
}

/**
 * Save manifest.yaml to a project
 * Creates .method directory if needed
 * Uses advisory file locking to prevent concurrent write corruption
 * Returns true on success, false on error
 */
function saveManifest(projectPath: string, manifest: any): boolean {
  const fs = getFs();
  const yaml = getYaml();
  try {
    const methodDir = path.join(projectPath, '.method');
    const manifestPath = path.join(methodDir, 'manifest.yaml');
    const lockPath = path.join(methodDir, '.manifest.lock');

    // Create .method directory if needed
    if (!fs.existsSync(methodDir)) {
      fs.mkdirSync(methodDir, { recursive: true });
    }

    // F-R-2: Acquire advisory lock (check if lock exists; if yes, wait 100ms + retry)
    let retries = 10;
    while (fs.existsSync(lockPath) && retries-- > 0) {
      // Synchronous sleep using busy-wait (simple lock acquisition)
      const startTime = Date.now();
      while (Date.now() - startTime < 100) {
        // Busy wait 100ms
      }
    }

    if (fs.existsSync(lockPath)) {
      console.warn(`Failed to acquire lock for ${projectPath} after 10 retries`);
      return false; // Lock timeout — fail gracefully
    }

    // Write lock file
    fs.writeFileSync(lockPath, Date.now().toString(), { encoding: 'utf-8' });

    try {
      // Serialize manifest with proper YAML formatting
      const content = yaml.dump(manifest);

      // Atomic write: write to temp file first, then rename
      const tempPath = `${manifestPath}.tmp`;
      fs.writeFileSync(tempPath, content, { encoding: 'utf-8' });
      fs.renameSync(tempPath, manifestPath);

      return true;
    } finally {
      // Release lock
      try {
        fs.unlinkSync(lockPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  } catch (err) {
    console.error(`Failed to save manifest to ${projectPath}:`, (err as Error).message);
    return false;
  }
}

/**
 * Find a methodology entry in the manifest's installed list
 * Returns index if found, -1 otherwise
 */
function findInstalledEntry(manifest: any, id: string, type: string): number {
  if (!manifest?.manifest?.installed || !Array.isArray(manifest.manifest.installed)) {
    return -1;
  }

  return manifest.manifest.installed.findIndex(
    (entry: any) => entry.id === id && entry.type === type,
  );
}

/**
 * Copy a methodology from source to target projects
 */
export async function copyMethodology(req: CopyMethodologyRequest, rootDir: string = process.cwd()): Promise<CopyResponse> {
  const { source_id, method_name, target_ids } = req;

  const results: CopyResult[] = [];

  // F-S-1: Validate target_ids array bounds and format
  const validation = validateTargetIds(target_ids);
  if (!validation.valid) {
    // Return 400 equivalent by returning error for all targets
    return {
      copied_to: [
        {
          project_id: '',
          status: 'error',
          error_detail: `Invalid target_ids: ${validation.error}`,
        },
      ],
    };
  }

  // Resolve source project path (with path traversal protection)
  let sourcePath: string;
  try {
    sourcePath = resolveProjectPath(source_id, rootDir);
  } catch (err) {
    // Path traversal or resolution error
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Invalid source project ID: ${(err as Error).message}`,
      });
    }
    return { copied_to: results };
  }

  // Load source manifest
  const sourceManifest = loadManifest(sourcePath);
  if (!sourceManifest) {
    // Source not found or invalid
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Source project "${source_id}" not found or manifest invalid`,
      });
    }
    return { copied_to: results };
  }

  // Find the methodology entry in source
  const sourceIndex = findInstalledEntry(sourceManifest, method_name, 'methodology');
  if (sourceIndex === -1) {
    // Methodology not found in source
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Methodology "${method_name}" not found in source project`,
      });
    }
    return { copied_to: results };
  }

  const methodologyEntry = sourceManifest.manifest.installed[sourceIndex];

  // Copy to each target
  for (const targetId of target_ids) {
    try {
      // Resolve target path with path traversal protection
      const targetPath = resolveProjectPath(targetId, rootDir);

      // Verify target exists by checking for .git directory
      if (!getFs().existsSync(path.join(targetPath, '.git'))) {
        results.push({
          project_id: targetId,
          status: 'error',
          error_detail: `Target project "${targetId}" not found or not a git repository`,
        });
        continue;
      }

      // Load target manifest
      let targetManifest = loadManifest(targetPath);
      if (!targetManifest) {
        // Create new manifest if doesn't exist
        targetManifest = {
          manifest: {
            project: targetId,
            last_updated: new Date().toISOString().split('T')[0],
            installed: [],
          },
        };
      }

      // Ensure manifest.installed is an array
      if (!Array.isArray(targetManifest.manifest?.installed)) {
        targetManifest.manifest = targetManifest.manifest || {};
        targetManifest.manifest.installed = [];
      }

      // Check if methodology already exists in target
      const existingIndex = findInstalledEntry(targetManifest, method_name, 'methodology');
      if (existingIndex !== -1) {
        // Replace existing
        targetManifest.manifest.installed[existingIndex] = { ...methodologyEntry };
      } else {
        // Add new
        targetManifest.manifest.installed.push({ ...methodologyEntry });
      }

      // Update last_updated timestamp
      targetManifest.manifest.last_updated = new Date().toISOString().split('T')[0];

      // Save to target
      const success = saveManifest(targetPath, targetManifest);
      if (success) {
        results.push({
          project_id: targetId,
          status: 'success',
        });
      } else {
        results.push({
          project_id: targetId,
          status: 'error',
          error_detail: 'Failed to write manifest to target project',
        });
      }
    } catch (err) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Error during copy: ${(err as Error).message}`,
      });
    }
  }

  return { copied_to: results };
}

/**
 * Copy a strategy from source to target projects
 */
export async function copyStrategy(req: CopyStrategyRequest, rootDir: string = process.cwd()): Promise<CopyResponse> {
  const { source_id, strategy_name, target_ids } = req;

  const results: CopyResult[] = [];

  // F-S-1: Validate target_ids array bounds and format
  const validation = validateTargetIds(target_ids);
  if (!validation.valid) {
    // Return 400 equivalent by returning error for all targets
    return {
      copied_to: [
        {
          project_id: '',
          status: 'error',
          error_detail: `Invalid target_ids: ${validation.error}`,
        },
      ],
    };
  }

  // Resolve source project path (with path traversal protection)
  let sourcePath: string;
  try {
    sourcePath = resolveProjectPath(source_id, rootDir);
  } catch (err) {
    // Path traversal or resolution error
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Invalid source project ID: ${(err as Error).message}`,
      });
    }
    return { copied_to: results };
  }

  // Load source manifest
  const sourceManifest = loadManifest(sourcePath);
  if (!sourceManifest) {
    // Source not found or invalid
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Source project "${source_id}" not found or manifest invalid`,
      });
    }
    return { copied_to: results };
  }

  // Find the strategy entry in source
  const sourceIndex = findInstalledEntry(sourceManifest, strategy_name, 'strategy');
  if (sourceIndex === -1) {
    // Strategy not found in source
    for (const targetId of target_ids) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Strategy "${strategy_name}" not found in source project`,
      });
    }
    return { copied_to: results };
  }

  const strategyEntry = sourceManifest.manifest.installed[sourceIndex];

  // Copy to each target
  for (const targetId of target_ids) {
    try {
      // Resolve target path with path traversal protection
      const targetPath = resolveProjectPath(targetId, rootDir);

      // Verify target exists by checking for .git directory
      if (!getFs().existsSync(path.join(targetPath, '.git'))) {
        results.push({
          project_id: targetId,
          status: 'error',
          error_detail: `Target project "${targetId}" not found or not a git repository`,
        });
        continue;
      }

      // Load target manifest
      let targetManifest = loadManifest(targetPath);
      if (!targetManifest) {
        // Create new manifest if doesn't exist
        targetManifest = {
          manifest: {
            project: targetId,
            last_updated: new Date().toISOString().split('T')[0],
            installed: [],
          },
        };
      }

      // Ensure manifest.installed is an array
      if (!Array.isArray(targetManifest.manifest?.installed)) {
        targetManifest.manifest = targetManifest.manifest || {};
        targetManifest.manifest.installed = [];
      }

      // Check if strategy already exists in target
      const existingIndex = findInstalledEntry(targetManifest, strategy_name, 'strategy');
      if (existingIndex !== -1) {
        // Replace existing
        targetManifest.manifest.installed[existingIndex] = { ...strategyEntry };
      } else {
        // Add new
        targetManifest.manifest.installed.push({ ...strategyEntry });
      }

      // Update last_updated timestamp
      targetManifest.manifest.last_updated = new Date().toISOString().split('T')[0];

      // Save to target
      const success = saveManifest(targetPath, targetManifest);
      if (success) {
        results.push({
          project_id: targetId,
          status: 'success',
        });
      } else {
        results.push({
          project_id: targetId,
          status: 'error',
          error_detail: 'Failed to write manifest to target project',
        });
      }
    } catch (err) {
      results.push({
        project_id: targetId,
        status: 'error',
        error_detail: `Error during copy: ${(err as Error).message}`,
      });
    }
  }

  return { copied_to: results };
}
