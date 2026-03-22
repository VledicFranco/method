/**
 * PRD-020: Project Isolation Layer — JsonLineEventPersistence
 *
 * High-performance event persistence using JSON Lines format.
 * One JSON object per line, newline-delimited. Supports streaming reads,
 * faster appends, and better scalability than YAML.
 *
 * Implements EventPersistence interface. Provides automatic migration from
 * legacy YAML format on first run.
 */

import { promises as fs } from 'fs';
import { existsSync, statSync, createReadStream } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import type { EventFilter, EventPersistence } from './event-persistence.js';
import type { ProjectEvent } from './project-event.js';
import { serializeProjectEvent, deserializeProjectEvent } from './project-event.js';

// Configuration
const ROTATION_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_BACKUP_FILES = 3; // Keep genesis-events.jsonl, .1.jsonl, .2.jsonl
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

export class JsonLineEventPersistence implements EventPersistence {
  private filePath: string;
  private events: ProjectEvent[] = [];
  private writeBuffer: ProjectEvent[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private lastFlushTime = 0;
  private yamlFallbackPath: string; // Path to legacy YAML file

  constructor(filePath: string, yamlFallbackPath?: string) {
    this.filePath = filePath;
    // Default fallback path: replace .jsonl with .yaml (or append if no extension)
    this.yamlFallbackPath = yamlFallbackPath || filePath.replace(/\.jsonl$/, '.yaml');
  }

  /**
   * Load events from disk on startup, with migration from YAML if needed
   */
  async recover(): Promise<void> {
    try {
      const dirPath = path.dirname(this.filePath);
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Check if we need to migrate from YAML
      if (
        !existsSync(this.filePath) &&
        existsSync(this.yamlFallbackPath) &&
        this.shouldMigrateFromYaml()
      ) {
        await this.migrateFromYaml();
        return;
      }

      // Load from JSONL file
      if (existsSync(this.filePath)) {
        await this.loadFromJsonl();
      }
    } catch (err) {
      console.error(`Failed to recover events from ${this.filePath}:`, err);
      // Continue with empty events on recovery failure
      this.events = [];
    }
  }

  /**
   * Check if YAML file exists and should be migrated
   */
  private shouldMigrateFromYaml(): boolean {
    try {
      return existsSync(this.yamlFallbackPath) && !existsSync(this.filePath);
    } catch {
      return false;
    }
  }

  /**
   * Migrate events from YAML format to JSONL
   */
  private async migrateFromYaml(): Promise<void> {
    try {
      console.log(`Migrating events from ${this.yamlFallbackPath} to ${this.filePath}`);

      // Dynamic import of YAML module (only needed for migration)
      const YAML = await import('js-yaml');

      const content = await fs.readFile(this.yamlFallbackPath, 'utf-8');
      if (!content.trim()) {
        return; // Empty file, nothing to migrate
      }

      const data = YAML.default.load(content) as SerializedEvent[];
      if (!Array.isArray(data)) {
        return; // Not an array, skip migration
      }

      // Write migrated events to JSONL
      const dirPath = path.dirname(this.filePath);
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      const lines = data.map((evt) => JSON.stringify(evt));
      const jsonlContent = lines.join('\n');

      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, jsonlContent, 'utf-8');
      await fs.rename(tmpPath, this.filePath);

      // Load migrated events into memory
      this.events = data.map((evt) => deserializeProjectEvent(evt));

      // Delete YAML file after successful migration
      await fs.unlink(this.yamlFallbackPath);
      console.log(`Successfully migrated to ${this.filePath}`);
    } catch (err) {
      console.error(`Failed to migrate from YAML:`, err);
      throw err;
    }
  }

  /**
   * Load events from JSONL file using streaming for large files
   */
  private async loadFromJsonl(): Promise<void> {
    return new Promise((resolve, reject) => {
      const rl = createInterface({
        input: createReadStream(this.filePath),
        crlfDelay: Infinity,
      });

      const events: ProjectEvent[] = [];
      let lineNumber = 0;

      rl.on('line', (line) => {
        lineNumber++;
        if (!line.trim()) {
          return; // Skip empty lines
        }

        try {
          const parsed = JSON.parse(line) as SerializedEvent;
          const event = deserializeProjectEvent(parsed);
          events.push(event);
        } catch (err) {
          console.warn(
            `Warning: Failed to parse event at line ${lineNumber} in ${this.filePath}:`,
            err
          );
          // Continue processing other lines
        }
      });

      rl.on('close', () => {
        this.events = events;
        resolve();
      });

      rl.on('error', (err) => {
        reject(err);
      });
    });
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

      // Serialize all events as JSONL (one per line)
      const lines = this.events.map((evt) => {
        const serialized = serializeProjectEvent(evt);
        return JSON.stringify(serialized);
      });
      const jsonlContent = lines.join('\n');

      // Write to temp file first (atomic write)
      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, jsonlContent, 'utf-8');

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
