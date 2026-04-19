// SPDX-License-Identifier: Apache-2.0
/**
 * ProjectLookup — Port for resolving project metadata by ID.
 *
 * Consumed by the Build Orchestrator domain to bind builds to a specific
 * project context (path, name, description). Avoids a direct import from
 * the projects domain (G-BOUNDARY).
 *
 * The composition root wires a concrete implementation backed by the
 * DiscoveryService / InMemoryProjectRegistry.
 */

export interface ProjectInfo {
  /** Project identifier (typically directory name). */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** Absolute path to project root. */
  path: string;
  /** Short description (from package.json or project-card essence). */
  description: string;
}

export interface ProjectLookup {
  /** Resolve a project by ID. Returns null if not found. */
  getProject(id: string): Promise<ProjectInfo | null>;
  /** List all discovered projects (for UI selectors). */
  listProjects(): Promise<ProjectInfo[]>;
}
