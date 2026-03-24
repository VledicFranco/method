/**
 * WS-3: Session persistence store for print-mode sessions.
 *
 * Persists session metadata and transcripts to .method/sessions/ using JSONL format
 * (following the existing event persistence pattern from the projects domain).
 * Each project accumulates a session history that survives bridge restarts.
 *
 * Port pattern: uses FileSystemProvider for all I/O operations (DR-15).
 * Path resolution handles both Windows and Unix paths (DR-06).
 */

import { join, normalize } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';

// ── Types ──

export interface PersistedSession {
  /** Session ID (UUID) */
  session_id: string;
  /** Working directory (identifies the project) */
  workdir: string;
  /** Human-readable nickname */
  nickname: string;
  /** Agent purpose description */
  purpose: string | null;
  /** Session mode: 'pty' | 'print' */
  mode: 'pty' | 'print';
  /** Session status at time of persistence */
  status: 'running' | 'idle' | 'ready' | 'dead' | 'working';
  /** When the session was created */
  created_at: string;
  /** When the session was last active */
  last_activity_at: string;
  /** Total prompt count */
  prompt_count: number;
  /** Session depth in chain */
  depth: number;
  /** Parent session ID if any */
  parent_session_id: string | null;
  /** Isolation mode */
  isolation: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Accumulated transcript for print-mode sessions */
  transcript?: string;
}

export interface SessionPersistenceStore {
  /** Save or update a session record */
  save(session: PersistedSession): Promise<void>;
  /** Load all persisted sessions, optionally filtered by workdir */
  loadAll(workdir?: string): Promise<PersistedSession[]>;
  /** Load a single session by ID */
  loadById(sessionId: string): Promise<PersistedSession | null>;
  /** Mark a session as dead (preserves the record) */
  markDead(sessionId: string): Promise<void>;
  /** Force flush to disk */
  flush(): Promise<void>;
}

// ── Implementation ──

const FLUSH_DEBOUNCE_MS = 200;
/** Reject session IDs containing path traversal sequences or path separators */
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function createSessionPersistenceStore(
  baseDir: string,
  fs: FileSystemProvider,
): SessionPersistenceStore {
  const sessionsDir = join(baseDir, '.method', 'sessions');
  const indexPath = join(sessionsDir, 'session-index.jsonl');

  let sessions: Map<string, PersistedSession> = new Map();
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let recovered = false;

  /** Ensure directory exists */
  function ensureDir(): void {
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
  }

  /** Recover sessions from disk */
  async function recover(): Promise<void> {
    if (recovered) return;
    recovered = true;

    try {
      ensureDir();

      if (!fs.existsSync(indexPath)) return;

      const content = fs.readFileSync(indexPath, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        try {
          const session = JSON.parse(line) as PersistedSession;
          sessions.set(session.session_id, session);
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error(`[session-persistence] Failed to recover: ${(err as Error).message}`);
    }
  }

  /** Flush sessions to disk */
  function flushToDisk(): void {
    if (!dirty) return;

    try {
      ensureDir();

      const lines = Array.from(sessions.values()).map((s) => JSON.stringify(s));
      const content = lines.join('\n');

      // Atomic write via temp file
      const tmpPath = indexPath + '.tmp';
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8' });
      fs.renameSync(tmpPath, indexPath);

      dirty = false;
    } catch (err) {
      console.error(`[session-persistence] Failed to flush: ${(err as Error).message}`);
    }
  }

  /** Schedule a debounced flush */
  function scheduleDirtyFlush(): void {
    dirty = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushToDisk();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Save transcript to a separate file for large transcripts */
  function saveTranscript(sessionId: string, transcript: string): void {
    if (!SAFE_SESSION_ID_RE.test(sessionId)) return; // Reject IDs with path separators
    try {
      ensureDir();
      const transcriptPath = join(sessionsDir, `${sessionId}.transcript.txt`);
      fs.writeFileSync(transcriptPath, transcript, { encoding: 'utf-8' });
    } catch (err) {
      console.error(`[session-persistence] Failed to save transcript: ${(err as Error).message}`);
    }
  }

  /** Load transcript from separate file */
  function loadTranscript(sessionId: string): string | undefined {
    if (!SAFE_SESSION_ID_RE.test(sessionId)) return undefined;
    try {
      const transcriptPath = join(sessionsDir, `${sessionId}.transcript.txt`);
      if (!fs.existsSync(transcriptPath)) return undefined;
      return fs.readFileSync(transcriptPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /** Normalize path for cross-platform comparison (DR-06) */
  function normalizePath(p: string): string {
    return normalize(p).replace(/\\/g, '/');
  }

  return {
    async save(session: PersistedSession): Promise<void> {
      await recover();

      // If transcript is large, store it in a separate file
      if (session.transcript && session.transcript.length > 1000) {
        saveTranscript(session.session_id, session.transcript);
        // Store a truncated version in the index
        const indexSession = { ...session, transcript: '[see transcript file]' };
        sessions.set(session.session_id, indexSession);
      } else {
        sessions.set(session.session_id, session);
      }

      scheduleDirtyFlush();
    },

    async loadAll(workdir?: string): Promise<PersistedSession[]> {
      await recover();

      let result = Array.from(sessions.values());

      if (workdir) {
        const normalizedWorkdir = normalizePath(workdir);
        result = result.filter((s) => normalizePath(s.workdir) === normalizedWorkdir);
      }

      // Sort by last_activity_at descending (most recent first)
      result.sort((a, b) =>
        new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
      );

      // Hydrate transcripts for sessions that have separate files
      for (const session of result) {
        if (session.transcript === '[see transcript file]') {
          const transcript = loadTranscript(session.session_id);
          if (transcript) {
            session.transcript = transcript;
          }
        }
      }

      return result;
    },

    async loadById(sessionId: string): Promise<PersistedSession | null> {
      await recover();
      const session = sessions.get(sessionId) ?? null;

      if (session && session.transcript === '[see transcript file]') {
        const transcript = loadTranscript(sessionId);
        if (transcript) {
          return { ...session, transcript };
        }
      }

      return session;
    },

    async markDead(sessionId: string): Promise<void> {
      await recover();
      const session = sessions.get(sessionId);
      if (session) {
        session.status = 'dead';
        session.last_activity_at = new Date().toISOString();
        scheduleDirtyFlush();
      }
    },

    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushToDisk();
    },
  };
}
