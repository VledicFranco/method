/**
 * PRD 018: Event Triggers — FileWatchTrigger (Phase 2a-1)
 *
 * Watches configured file paths using fs.watch() and emits trigger events
 * when files are created, modified, or deleted. Supports recursive watching
 * on Windows/macOS.
 */

import { watch, existsSync, statSync, type FSWatcher } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { minimatch } from './glob-match.js';
import type {
  TriggerWatcher,
  TriggerType,
  FileWatchTriggerConfig,
} from './types.js';

export class FileWatchTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'file_watch';

  private _active = false;
  private watchers: FSWatcher[] = [];
  private readonly config: FileWatchTriggerConfig;
  private readonly baseDir: string;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;
  private readonly allowedEvents: Set<string>;
  private readonly isRecursiveSupported: boolean;

  constructor(config: FileWatchTriggerConfig, baseDir: string) {
    this.config = config;
    this.baseDir = resolve(baseDir);
    this.allowedEvents = new Set(config.events ?? ['create', 'modify', 'delete']);

    // Recursive fs.watch() is supported on Windows and macOS, not Linux
    this.isRecursiveSupported = process.platform !== 'linux';
  }

  get active(): boolean {
    return this._active;
  }

  start(onFire: (payload: Record<string, unknown>) => void): void {
    if (this._active) return;
    this.onFire = onFire;
    this._active = true;

    // Resolve unique directories from the configured glob paths
    const watchDirs = this.resolveWatchDirectories();

    for (const dir of watchDirs) {
      if (!existsSync(dir)) continue;

      try {
        const watcher = watch(
          dir,
          { recursive: this.isRecursiveSupported },
          (eventType, filename) => {
            if (!filename) return;
            this.handleEvent(eventType, filename, dir);
          },
        );

        watcher.on('error', () => {
          // Silently handle watcher errors — directory may have been deleted
        });

        this.watchers.push(watcher);
      } catch {
        // fs.watch() can throw on some platforms — skip this directory
      }
    }
  }

  stop(): void {
    this._active = false;
    for (const w of this.watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this.watchers = [];
    this.onFire = null;
  }

  private handleEvent(eventType: string, filename: string, watchDir: string): void {
    if (!this.onFire || !this._active) return;

    const fullPath = resolve(watchDir, filename);
    const relPath = relative(this.baseDir, fullPath).replace(/\\/g, '/');

    // Check if the file matches any of the configured glob patterns
    const matched = this.config.paths.some((pattern) => minimatch(relPath, pattern));
    if (!matched) return;

    // Determine the event type (create/modify/delete)
    let fileEvent: 'create' | 'modify' | 'delete';
    try {
      if (existsSync(fullPath)) {
        // fs.watch 'rename' can mean create or delete; 'change' means modify
        fileEvent = eventType === 'rename' ? 'create' : 'modify';
      } else {
        fileEvent = 'delete';
      }
    } catch {
      fileEvent = 'modify';
    }

    if (!this.allowedEvents.has(fileEvent)) return;

    this.onFire({
      path: relPath,
      event_type: fileEvent,
      filename: filename,
    });
  }

  /**
   * Extract unique parent directories from the glob patterns.
   * For a pattern like "docs/prds/*.md", the watch directory is "docs/prds".
   * For "**" patterns, we watch the base directory.
   */
  private resolveWatchDirectories(): string[] {
    const dirs = new Set<string>();

    for (const pattern of this.config.paths) {
      // Find the static prefix (everything before the first glob character)
      const parts = pattern.split('/');
      const staticParts: string[] = [];

      for (const part of parts) {
        if (part.includes('*') || part.includes('?') || part.includes('[') || part.includes('{')) {
          break;
        }
        staticParts.push(part);
      }

      const dir = staticParts.length > 0
        ? resolve(this.baseDir, staticParts.join('/'))
        : this.baseDir;

      // If the resolved path is a file, watch its parent
      try {
        if (existsSync(dir) && statSync(dir).isFile()) {
          dirs.add(dirname(dir));
        } else {
          dirs.add(dir);
        }
      } catch {
        dirs.add(dir);
      }
    }

    return Array.from(dirs);
  }
}
