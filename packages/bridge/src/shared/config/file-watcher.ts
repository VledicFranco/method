/**
 * File Watcher — Watch .method directory for config changes
 *
 * Watches:
 * - .method/manifest.yaml
 * - .method directories for manifest.yaml
 * - .method/council directory
 * - .method/delivery directory
 *
 * Debounced 100ms to avoid multiple triggers per batch change.
 * Triggers ProjectRegistry.rescan() on file changes.
 */

import { watch, existsSync, readdirSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { ProjectRegistry } from '../../domains/registry/index.js';

export type FileWatcherCallback = () => Promise<void>;

export interface FileWatcherOptions {
  debounceMs?: number;
  watchDir?: string;
}

/**
 * Debouncer utility
 */
function createDebouncer(callback: FileWatcherCallback, delayMs: number) {
  let timeoutId: NodeJS.Timeout | null = null;

  return async () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(async () => {
      try {
        await callback();
      } catch (err) {
        console.error('[FileWatcher] Callback error:', (err as Error).message);
      }
      timeoutId = null;
    }, delayMs);
  };
}

/**
 * File Watcher class
 */
export class FileWatcher {
  private watchDir: string;
  private debounceMs: number;
  private rootDir: string;
  private watchers: Map<string, FSWatcher> = new Map();
  private debouncedCallback: (() => Promise<void>) | null = null;
  private active = false;

  constructor(private registry: ProjectRegistry, options: FileWatcherOptions = {}, rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
    this.watchDir = options.watchDir || join(rootDir, '.method');
    this.debounceMs = options.debounceMs || 100;
  }

  /**
   * Start watching the .method directory
   */
  start(callback: FileWatcherCallback): void {
    if (this.active) {
      return; // Already watching
    }

    this.active = true;
    this.debouncedCallback = createDebouncer(callback, this.debounceMs);

    // Watch .method directory recursively
    this.watchDirectory(this.watchDir);
    console.log(`[FileWatcher] Started watching ${this.watchDir} (debounce: ${this.debounceMs}ms)`);
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    // Close all watchers
    for (const [, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (err) {
        // Ignore close errors
      }
    }

    this.watchers.clear();
    console.log('[FileWatcher] Stopped watching');
  }

  /**
   * Watch a directory recursively
   */
  private watchDirectory(dir: string): void {
    if (!existsSync(dir)) {
      return; // Directory doesn't exist yet
    }

    try {
      const watcher = watch(dir, { recursive: true }, async (eventType, filename) => {
        if (!filename) return;

        const filePath = join(dir, filename);

        // Filter for relevant files
        if (this.shouldProcessFile(filename, filePath)) {
          console.log(`[FileWatcher] Detected change: ${filePath} (${eventType})`);

          if (this.debouncedCallback) {
            await this.debouncedCallback();
          }
        }
      });

      this.watchers.set(dir, watcher);
    } catch (err) {
      console.warn(`[FileWatcher] Failed to watch ${dir}:`, (err as Error).message);
    }
  }

  /**
   * Check if a file should trigger a rescan
   */
  private shouldProcessFile(filename: string, filePath: string): boolean {
    // Watch manifest.yaml files
    if (filename.includes('manifest.yaml')) {
      return true;
    }

    // Watch files in council directory
    if (filePath.includes(join('.method', 'council'))) {
      return true;
    }

    // Watch files in delivery directory
    if (filePath.includes(join('.method', 'delivery'))) {
      return true;
    }

    // Watch .method root for YAML files
    if (filePath.startsWith(join(this.rootDir, '.method')) && filename.endsWith('.yaml')) {
      const dir = join(this.rootDir, '.method');
      if (filePath.startsWith(dir)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Create and start a file watcher
 */
export function createFileWatcher(
  registry: ProjectRegistry,
  callback: FileWatcherCallback,
  options: FileWatcherOptions = {},
  rootDir: string = process.cwd(),
): FileWatcher {
  const watcher = new FileWatcher(registry, options, rootDir);
  watcher.start(callback);
  return watcher;
}
