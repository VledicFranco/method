/**
 * PRD-020: Project Isolation Layer — YamlEventPersistence
 *
 * Disk-based event persistence with async-buffered writes, file rotation,
 * and startup recovery. Implements EventPersistence interface.
 */

import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';
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

export class YamlEventPersistence implements EventPersistence {
  private filePath: string;
  private events: ProjectEvent[] = [];
  private writeBuffer: ProjectEvent[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private lastFlushTime = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load events from disk on startup
   */
  async recover(): Promise<void> {
    try {
      const dirPath = path.dirname(this.filePath);
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
          }
        }
      }
    } catch (err) {
      console.error(`Failed to recover events from ${this.filePath}:`, err);
      // Continue with empty events on recovery failure
      this.events = [];
    }
  }

  /**
   * Append an event with buffering and debounced flush
   */
  async append(event: ProjectEvent): Promise<void> {
    this.events.push(event);
    this.writeBuffer.push(event);

    // Debounce flush
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flushToDisk().catch((err) => {
        console.error('Failed to flush events to disk:', err);
      });
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Query events with optional filtering
   */
  async query(filter: EventFilter): Promise<ProjectEvent[]> {
    return this.events.filter((evt) => {
      if (filter.projectId && evt.projectId !== filter.projectId) {
        return false;
      }
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
