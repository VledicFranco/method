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

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

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

/**
 * Resolve project directory path from project ID
 * In Phase 1, we assume project ID = project directory name
 * Root is process.cwd()
 */
function resolveProjectPath(projectId: string): string {
  // Special case: root project
  if (projectId === 'root' || projectId === '.') {
    return process.cwd();
  }

  // If projectId contains path separators, treat as relative path
  // Otherwise, treat as sibling directory
  if (projectId.includes(path.sep) || projectId.includes('/')) {
    return path.resolve(projectId);
  }

  return path.resolve(process.cwd(), projectId);
}

/**
 * Load manifest.yaml from a project
 * Returns null if file doesn't exist or is invalid
 */
function loadManifest(projectPath: string): any | null {
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
    fs.writeFileSync(lockPath, Date.now().toString(), 'utf-8');

    try {
      // Serialize manifest with proper YAML formatting
      const content = yaml.dump(manifest, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      // Atomic write: write to temp file first, then rename
      const tempPath = `${manifestPath}.tmp`;
      fs.writeFileSync(tempPath, content, 'utf-8');
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
export async function copyMethodology(req: CopyMethodologyRequest): Promise<CopyResponse> {
  const { source_id, method_name, target_ids } = req;

  const results: CopyResult[] = [];

  // Resolve source project path
  const sourcePath = resolveProjectPath(source_id);

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
      const targetPath = resolveProjectPath(targetId);

      // Verify target exists by checking for .git directory
      if (!fs.existsSync(path.join(targetPath, '.git'))) {
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
export async function copyStrategy(req: CopyStrategyRequest): Promise<CopyResponse> {
  const { source_id, strategy_name, target_ids } = req;

  const results: CopyResult[] = [];

  // Resolve source project path
  const sourcePath = resolveProjectPath(source_id);

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
      const targetPath = resolveProjectPath(targetId);

      // Verify target exists by checking for .git directory
      if (!fs.existsSync(path.join(targetPath, '.git'))) {
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
