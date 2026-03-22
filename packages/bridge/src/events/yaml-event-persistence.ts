/**
 * PRD-020: Project Isolation Layer — YamlEventPersistence
 *
 * Disk-based event persistence with async-buffered writes, file rotation,
 * and startup recovery. Implements EventPersistence interface.
 */

import { promises as fs } from 'fs';
import { existsSync, statSync, accessSync, constants as fsConstants } from 'fs';
import path from 'path';
import YAML from 'js-yaml';
import type { EventFilter, EventPersistence } from './event-persistence.js';
import type { ProjectEvent } from './project-event.js';
import { serializeProjectEvent, deserializeProjectEvent } from './project-event.js';

// Configuration
const ROTATION_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_BACKUP_FILES = 3; // Keep genesis-events.yaml, .1.yaml, .2.yaml
const FLUSH_DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 100;

interface SerializedEvent {
  id: string;
  type: string;
  projectId: string;
  timestamp: string;
  data: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Validate that a directory exists and is writable
 * F-R-003: Directory Permission Validation
 */
function validateDirectoryWritable(dirPath: string): boolean {
  try {
    accessSync(dirPath, fsConstants.W_OK);
    return true;
  } catch (err: any) {
    // EACCES = permission denied, ENOENT = doesn't exist
    if (err.code === 'EACCES' || err.code === 'ENOENT') {
      return false;
    }
    // Re-throw unexpected errors
    throw err;
  }
}

/**
 * Validate that a directory can be created and written to
 * F-R-003: Directory Permission Validation
 * Allows creation as long as an ancestor directory exists and is writable
 */
function validateDirectoryCreatable(dirPath: string): boolean {
  // If directory exists, it must be writable
  if (existsSync(dirPath)) {
    return validateDirectoryWritable(dirPath);
  }

  // Walk up the tree to find an existing ancestor directory
  let currentPath = dirPath;
  while (!existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    // If we've reached the root and it doesn't exist, fail
    if (parentPath === currentPath) {
      return false;
    }
    currentPath = parentPath;
  }

  // We found an existing ancestor. Check if it's writable.
  return validateDirectoryWritable(currentPath);
}

export class YamlEventPersistence implements EventPersistence {
  private filePath: string;
  private events: ProjectEvent[] = [];
  private writeBuffer: ProjectEvent[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private lastFlushTime = 0;
  private projectIdIndex: Map<string, number[]> = new Map(); // projectId -> event indices
  private pendingFlushPromise: Promise<void> | null = null;
  private pendingFlushResolve: (() => void) | null = null;
  private pendingFlushReject: ((err: Error) => void) | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;

    // F-R-003: Validate directory permissions on initialization
    const dirPath = path.dirname(filePath);

    if (!validateDirectoryCreatable(dirPath)) {
      // Find the problematic ancestor directory for a better error message
      let ancestorPath = dirPath;
      while (!existsSync(ancestorPath)) {
        ancestorPath = path.dirname(ancestorPath);
      }

      throw new Error(
        `Cannot initialize YamlEventPersistence: ` +
        `ancestor directory ${ancestorPath} does not have write permissions. ` +
        `Check permissions and try again.`
      );
    }
  }

  /**
   * Load events from disk on startup and rebuild index
   */
  async recover(): Promise<void> {
    try {
      const dirPath = path.dirname(this.filePath);

      // F-R-003: Pre-recovery check - validate directory is creatable before attempting recovery
      if (!validateDirectoryCreatable(dirPath)) {
        throw new Error(
          `Directory ${dirPath} cannot be created or is not writable. ` +
          `Cannot proceed with event recovery.`
        );
      }

      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Try to load from main file
      if (existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, 'utf-8');
        if (content.trim()) {
          const data = YAML.load(content) as SerializedEvent[];
          if (Array.isArray(data)) {
            this.events = data.map((evt) => deserializeProjectEvent(evt));
            this.rebuildIndex();
          }
        }
      }
    } catch (err) {
      console.error(`Failed to recover events from ${this.filePath}:`, err);
      // Continue with empty events on recovery failure
      this.events = [];
      this.projectIdIndex.clear();
    }
  }

  /**
   * Rebuild projectId index from current events array
   */
  private rebuildIndex(): void {
    this.projectIdIndex.clear();
    for (let i = 0; i < this.events.length; i++) {
      const projectId = this.events[i].projectId;
      if (!this.projectIdIndex.has(projectId)) {
        this.projectIdIndex.set(projectId, []);
      }
      this.projectIdIndex.get(projectId)!.push(i);
    }
  }

  /**
   * Append an event with buffering and debounced flush
   * Also maintains the projectId index
   * Throws if flush fails (after retries)
   */
  async append(event: ProjectEvent): Promise<void> {
    this.events.push(event);
    this.writeBuffer.push(event);

    // Update index for this project
    const eventIndex = this.events.length - 1;
    if (!this.projectIdIndex.has(event.projectId)) {
      this.projectIdIndex.set(event.projectId, []);
    }
    this.projectIdIndex.get(event.projectId)!.push(eventIndex);

    // Debounce flush - create a shared promise if this is the first append
    if (!this.pendingFlushPromise) {
      this.pendingFlushPromise = new Promise<void>((resolve, reject) => {
        this.pendingFlushResolve = resolve;
        this.pendingFlushReject = reject;
      });
    }

    // Cancel and reschedule timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flushToDisk()
        .then(() => {
          if (this.pendingFlushResolve) {
            this.pendingFlushResolve();
          }
          this.pendingFlushPromise = null;
          this.pendingFlushResolve = null;
          this.pendingFlushReject = null;
        })
        .catch((err) => {
          console.error('Failed to flush events to disk:', err);
          if (this.pendingFlushReject) {
            this.pendingFlushReject(err as Error);
          }
          this.pendingFlushPromise = null;
          this.pendingFlushResolve = null;
          this.pendingFlushReject = null;
        });
    }, FLUSH_DEBOUNCE_MS);

    // Return the shared promise so all concurrent appends wait for the same flush
    return this.pendingFlushPromise;
  }

  /**
   * Query events with optional filtering
   * Uses projectId index to narrow search space when available
   */
  async query(filter: EventFilter): Promise<ProjectEvent[]> {
    let candidates = this.events;

    // Use index to narrow search space if projectId filter is present
    if (filter.projectId) {
      const indices = this.projectIdIndex.get(filter.projectId);
      if (!indices) {
        return []; // No events for this project
      }
      candidates = indices.map((i) => this.events[i]);
    }

    // Apply remaining filters on candidates
    return candidates.filter((evt) => {
      if (filter.type && evt.type !== filter.type) {
        return false;
      }
      if (filter.since && evt.timestamp < filter.since) {
        return false;
      }
      if (filter.until && evt.timestamp > filter.until) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get the N most recent events
   */
  async latest(count: number): Promise<ProjectEvent[]> {
    return this.events.slice(-count);
  }

  /**
   * Flush write buffer to disk with retry, rotation, and atomic writes
   */
  private async flushToDisk(): Promise<void> {
    if (this.writeBuffer.length === 0) {
      return;
    }

    // Clear timeout
    this.flushTimeout = null;

    const dirPath = path.dirname(this.filePath);
    await this.retryWrite(async () => {
      // Ensure directory exists
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Check if rotation is needed
      if (existsSync(this.filePath)) {
        const stats = statSync(this.filePath);
        if (stats.size >= ROTATION_SIZE_BYTES) {
          await this.rotateFile();
        }
      }

      // Serialize all events
      const serialized = this.events.map((evt) => serializeProjectEvent(evt));
      const yaml = YAML.dump(serialized, { lineWidth: -1 });

      // Write to temp file first (atomic write)
      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, yaml, 'utf-8');

      // Atomic rename
      await fs.rename(tmpPath, this.filePath);

      // Clear buffer
      this.writeBuffer = [];
      this.lastFlushTime = Date.now();
    });
  }

  /**
   * Rotate file when it exceeds size limit
   */
  private async rotateFile(): Promise<void> {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);

    // Shift existing backups
    for (let i = MAX_BACKUP_FILES - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${base}.${i}`);
      const newPath = path.join(dir, `${base}.${i + 1}`);

      if (existsSync(oldPath)) {
        if (i + 1 <= MAX_BACKUP_FILES) {
          await fs.rename(oldPath, newPath);
        } else {
          await fs.unlink(oldPath);
        }
      }
    }

    // Rename current file to .1
    const backupPath = path.join(dir, `${base}.1`);
    if (existsSync(this.filePath)) {
      await fs.rename(this.filePath, backupPath);
    }
  }

  /**
   * Retry write operation with exponential backoff
   */
  private async retryWrite(op: () => Promise<void>): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await op();
        return; // Success
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES - 1) {
          const backoffMs = RETRY_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw lastError || new Error('Write operation failed');
  }
}
