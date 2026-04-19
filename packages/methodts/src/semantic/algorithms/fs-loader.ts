// SPDX-License-Identifier: Apache-2.0
/**
 * Filesystem loader for FCA-recursive algorithms.
 *
 * Defines a FsLoader port interface for reading component documentation
 * and listing children. Provides a live implementation (Node fs) and a
 * test implementation (in-memory).
 *
 * The port is synchronous because the `recurse` operator's `decompose`
 * function is synchronous — it can't await async I/O. This is a known
 * constraint (see open question in advice/03-recursive-semantic-algorithms.md).
 *
 * @see F-PORT-1 — This port replaces direct node:fs imports at L2.
 */

import type { ExploreInput } from "./explore.js";

// ── Port interface ──

/**
 * Port for loading component context from the filesystem.
 *
 * Synchronous because `decompose` in the `recurse` operator is synchronous.
 * Injected at the call site, not via Effect — this keeps the decompose
 * function pure from Effect's perspective.
 */
export interface FsLoader {
  /** Read a file's content. Returns empty string if not found. */
  readFile(path: string): string;
  /** Check if a path exists. */
  exists(path: string): boolean;
  /** List entries in a directory. Returns empty array if not found. */
  readDir(path: string): string[];
  /** Check if a path is a directory. */
  isDirectory(path: string): boolean;
}

// ── Load options ──

export type LoadOptions = {
  readonly excludeDirs?: readonly string[];
  readonly excludeFiles?: readonly string[];
};

const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  "__pycache__", ".tsbuildinfo", "coverage", ".nyc_output",
]);

const DEFAULT_EXCLUDE_FILES = new Set([
  ".DS_Store", "Thumbs.db", ".gitkeep",
]);

// ── Core loading functions (port-parameterized) ──

/**
 * Load an ExploreInput from the filesystem via the FsLoader port.
 */
export function loadExploreInput(
  fs: FsLoader,
  query: string,
  path: string,
  level: number,
  options?: LoadOptions,
): ExploreInput {
  const excludeDirs = new Set([
    ...DEFAULT_EXCLUDE_DIRS,
    ...(options?.excludeDirs ?? []),
  ]);
  const excludeFiles = new Set([
    ...DEFAULT_EXCLUDE_FILES,
    ...(options?.excludeFiles ?? []),
  ]);

  const documentation = readDocumentation(fs, path, level);
  const children = listChildren(fs, path, level, excludeDirs, excludeFiles);

  return { query, path, level, documentation, children };
}

/**
 * Load ExploreInputs for children of a parent result.
 */
export function loadChildInputs(
  fs: FsLoader,
  query: string,
  selectedPaths: readonly string[],
  parentPath: string,
  parentLevel: number,
  options?: LoadOptions,
): ExploreInput[] {
  return selectedPaths.map((childPath) => {
    const fullPath = childPath.startsWith("/") || childPath.includes(":")
      ? childPath
      : join(parentPath, childPath);
    return loadExploreInput(fs, query, fullPath, parentLevel - 1, options);
  });
}

// ── Live implementation ──

/**
 * Live FsLoader using Node.js synchronous fs operations.
 *
 * Use this at the call site when running against a real filesystem.
 */
export function liveFsLoader(): FsLoader {
  // Lazy import to keep the module importable without side effects
  const nodeFs = require("node:fs") as typeof import("node:fs");

  return {
    readFile(path: string): string {
      try {
        return nodeFs.readFileSync(path, "utf-8");
      } catch {
        return "";
      }
    },
    exists(path: string): boolean {
      return nodeFs.existsSync(path);
    },
    readDir(path: string): string[] {
      try {
        return nodeFs.readdirSync(path);
      } catch {
        return [];
      }
    },
    isDirectory(path: string): boolean {
      try {
        return nodeFs.statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

/**
 * In-memory FsLoader for testing.
 *
 * Files are a Record<path, content>. Directories are inferred from file paths.
 */
export function testFsLoader(files: Record<string, string>): FsLoader {
  const allPaths = Object.keys(files);

  return {
    readFile(path: string): string {
      return files[path] ?? "";
    },
    exists(path: string): boolean {
      // Check exact file or if any file starts with this as a directory prefix
      if (path in files) return true;
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return allPaths.some((p) => p.startsWith(prefix));
    },
    readDir(path: string): string[] {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries = new Set<string>();
      for (const p of allPaths) {
        if (p.startsWith(prefix)) {
          const relative = p.slice(prefix.length);
          const firstSegment = relative.split("/")[0];
          if (firstSegment) entries.add(firstSegment);
        }
      }
      return [...entries].sort();
    },
    isDirectory(path: string): boolean {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return allPaths.some((p) => p.startsWith(prefix));
    },
  };
}

// ── Detect FCA level ──

export function detectLevel(fs: FsLoader, dirPath: string): number {
  if (fs.exists(join(dirPath, "package.json"))) return 3;

  const indexPath = join(dirPath, "index.ts");
  if (fs.exists(indexPath)) {
    const content = fs.readFile(indexPath);
    if (content.includes("export *") || content.includes("export {")) return 2;
  }

  const entries = fs.readDir(dirPath);
  if (entries.some((e) => e.endsWith(".ts"))) return 1;

  return 0;
}

// ── Internal helpers ──

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function readDocumentation(fs: FsLoader, dirPath: string, level: number): string {
  const parts: string[] = [];

  // README.md
  const readmePath = join(dirPath, "README.md");
  if (fs.exists(readmePath)) {
    const content = fs.readFile(readmePath);
    if (content) {
      parts.push(content.length > 1000 ? content.slice(0, 1000) + "\n...(truncated)" : content);
    }
  }

  // index.ts header + exports (L1-L2)
  if (level <= 2) {
    const indexPath = join(dirPath, "index.ts");
    if (fs.exists(indexPath)) {
      const content = fs.readFile(indexPath);
      if (content) {
        const headerMatch = content.match(/^(\/\*\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n\/\/[^\n]*)*)/);
        if (headerMatch) parts.push(`\n### index.ts header:\n${headerMatch[0]}`);
        const exportLines = content.split("\n")
          .filter((line) => line.startsWith("export"))
          .slice(0, 30);
        if (exportLines.length > 0) parts.push(`\n### Exports:\n${exportLines.join("\n")}`);
      }
    }
  }

  // package.json (L3)
  if (level >= 3) {
    const pkgPath = join(dirPath, "package.json");
    if (fs.exists(pkgPath)) {
      const raw = fs.readFile(pkgPath);
      if (raw) {
        try {
          const pkg = JSON.parse(raw);
          parts.push(`\n### package.json:\n- name: ${pkg.name}\n- description: ${pkg.description ?? "(none)"}`);
          if (pkg.exports) parts.push(`- exports: ${Object.keys(pkg.exports).join(", ")}`);
        } catch { /* skip malformed */ }
      }
    }
  }

  return parts.join("\n\n") || "(no documentation found)";
}

function listChildren(
  fs: FsLoader,
  dirPath: string,
  level: number,
  excludeDirs: Set<string>,
  excludeFiles: Set<string>,
): string[] {
  if (!fs.exists(dirPath)) return [];

  const entries = fs.readDir(dirPath);
  const children: string[] = [];

  for (const entry of entries) {
    if (excludeFiles.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    if (excludeDirs.has(entry)) continue;

    const fullPath = join(dirPath, entry);
    if (fs.isDirectory(fullPath)) {
      children.push(entry);
    } else if (level <= 1 && entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      children.push(entry);
    }
  }

  return children.sort();
}
