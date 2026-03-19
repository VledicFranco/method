import * as pty from 'node-pty';
import PQueue from 'p-queue';
import { extractResponse } from './parser.js';
import { AdaptiveSettleDelay } from './adaptive-settle.js';

export type SessionStatus = 'initializing' | 'ready' | 'working' | 'dead';

export interface PtySession {
  readonly id: string;
  /** OS process ID of the outer PTY shell (null for print-mode sessions). */
  readonly pid: number | null;
  status: SessionStatus;
  /** Number of prompts queued (including the one currently in-flight). */
  queueDepth: number;
  /** Total number of prompts sent through this session. */
  promptCount: number;
  /** Timestamp of the last prompt send or response receipt. */
  lastActivityAt: Date;
  /** PRD 007: Full PTY output since spawn. */
  readonly transcript: string;
  /** PRD 007: Subscribe to live PTY output. Returns unsubscribe function. */
  onOutput(cb: (data: string) => void): () => void;
  /** PRD 010: Subscribe to PTY process exit. */
  onExit(cb: (exitCode: number) => void): void;
  sendPrompt(prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }>;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** PRD 012 Phase 2: Adaptive settle delay instance (null if disabled). */
  readonly adaptiveSettle: AdaptiveSettleDelay | null;
}

export interface SpawnOptions {
  id: string;
  workdir: string;
  claudeBin?: string;
  settleDelayMs?: number;
  initialPrompt?: string;
  spawnArgs?: string[];
  /** PRD 012 Phase 2: Adaptive settle delay instance (enables adaptive algorithm). */
  adaptiveSettle?: AdaptiveSettleDelay;
}

const DEFAULT_SETTLE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

// ── Ring buffer for transcript — avoids 5 MB string reallocation ──

const TRANSCRIPT_CHUNK_SLOTS = 2048;

export class TranscriptRingBuffer {
  private chunks: (string | undefined)[];
  private head = 0;    // index of oldest chunk
  private count = 0;   // number of live chunks
  private totalLen = 0; // total character length across live chunks
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.chunks = new Array(TRANSCRIPT_CHUNK_SLOTS);
  }

  get length(): number { return this.totalLen; }

  /** O(1) amortized append — drops oldest chunks to stay within budget. */
  append(data: string): void {
    // Compact if chunk slots are exhausted (rare — ~2k slots for ~5 MB)
    if (this.count === TRANSCRIPT_CHUNK_SLOTS) {
      this.compact();
    }

    const writeIdx = (this.head + this.count) % TRANSCRIPT_CHUNK_SLOTS;
    this.chunks[writeIdx] = data;
    this.count++;
    this.totalLen += data.length;

    // Evict oldest chunks until within budget
    while (this.totalLen > this.maxSize && this.count > 1) {
      const oldest = this.chunks[this.head]!;
      this.chunks[this.head] = undefined;
      this.totalLen -= oldest.length;
      this.head = (this.head + 1) % TRANSCRIPT_CHUNK_SLOTS;
      this.count--;
    }

    // If single remaining chunk exceeds limit, trim it
    if (this.totalLen > this.maxSize && this.count === 1) {
      const chunk = this.chunks[this.head]!;
      const trimmed = chunk.substring(chunk.length - this.maxSize);
      this.chunks[this.head] = trimmed;
      this.totalLen = trimmed.length;
    }
  }

  /** Merge all chunks into one slot — escape hatch when slots are exhausted. */
  private compact(): void {
    const merged = this.toString();
    this.chunks = new Array(TRANSCRIPT_CHUNK_SLOTS);
    this.head = 0;
    this.count = 1;
    this.chunks[0] = merged;
    this.totalLen = merged.length;
  }

  /** Materialize the full transcript string. Called on read (cold path). */
  toString(): string {
    if (this.count === 0) return '';
    if (this.count === 1) return this.chunks[this.head]!;
    const parts: string[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      parts[i] = this.chunks[(this.head + i) % TRANSCRIPT_CHUNK_SLOTS]!;
    }
    return parts.join('');
  }
}

/**
 * Spawn a new Claude Code PTY session.
 *
 * The session enters 'initializing' state immediately. Once the ❯ prompt
 * character appears in PTY output, state transitions to 'ready'. If an
 * initialPrompt is provided, it is sent once the session is ready.
 */
export function spawnSession(options: SpawnOptions): PtySession {
  const {
    id,
    workdir,
    claudeBin = 'claude',
    settleDelayMs = DEFAULT_SETTLE_DELAY_MS,
    initialPrompt,
    spawnArgs,
    adaptiveSettle = null,
  } = options;

  let status: SessionStatus = 'initializing';
  let promptCount = 0;
  let lastActivityAt = new Date();
  const queue = new PQueue({ concurrency: 1 });

  /** Read current status — defeats TypeScript's control-flow narrowing for async mutations. */
  const getStatus = (): SessionStatus => status;

  // Spawn the PTY process — append spawnArgs to the Claude binary command
  const cliFlags = spawnArgs?.join(' ') ?? '';
  const fullCmd = cliFlags ? `${claudeBin} ${cliFlags}` : claudeBin;
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['/c', fullCmd] : ['-c', fullCmd];

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 200,
    rows: 50,
    cwd: workdir,
    env: {
      ...process.env,
      BRIDGE_URL: process.env.BRIDGE_URL ?? `http://localhost:${process.env.PORT ?? '3456'}`,
      BRIDGE_SESSION_ID: id,
    } as Record<string, string>,
  });

  // Buffer for accumulating PTY output
  let outputBuffer = '';
  let dataCallback: ((data: string) => void) | null = null;

  // PRD 007: Full transcript ring buffer + live output subscribers
  const MAX_TRANSCRIPT_SIZE = parseInt(process.env.MAX_TRANSCRIPT_SIZE_BYTES ?? '5242880', 10);
  const transcriptRing = new TranscriptRingBuffer(MAX_TRANSCRIPT_SIZE);
  const outputSubscribers = new Set<(data: string) => void>();

  // PRD 010: Exit callbacks
  const exitCallbacks: Array<(exitCode: number) => void> = [];

  // Listen for PTY data
  ptyProcess.onData((data: string) => {
    outputBuffer += data;

    // PRD 007: Accumulate transcript via ring buffer (O(1) append, no reallocation)
    transcriptRing.append(data);

    // PRD 007: Notify live output subscribers
    for (const sub of outputSubscribers) {
      try { sub(data); } catch { /* subscriber errors are non-fatal */ }
    }

    if (dataCallback) {
      dataCallback(data);
    }
  });

  // Watch for initial ready state
  const initWatcher = (data: string) => {
    if (data.includes('❯') && status === 'initializing') {
      status = 'ready';
      dataCallback = null;

      // Send initial prompt if provided
      if (initialPrompt) {
        // Queue the initial prompt — don't await here, let it run async
        session.sendPrompt(initialPrompt).catch(() => {
          // Initial prompt failure is non-fatal; session remains usable
        });
      }
    }
  };
  dataCallback = initWatcher;

  // Handle unexpected exit
  ptyProcess.onExit(({ exitCode }) => {
    status = 'dead';
    dataCallback = null;
    for (const cb of exitCallbacks) {
      try { cb(exitCode); } catch { /* exit callback errors are non-fatal */ }
    }
  });

  const session: PtySession = {
    id,

    get pid() {
      return ptyProcess.pid;
    },

    get status() {
      return status;
    },
    set status(s: SessionStatus) {
      status = s;
    },

    get queueDepth() {
      return queue.size + queue.pending;
    },

    get promptCount() {
      return promptCount;
    },
    set promptCount(n: number) {
      promptCount = n;
    },

    get lastActivityAt() {
      return lastActivityAt;
    },
    set lastActivityAt(d: Date) {
      lastActivityAt = d;
    },

    get transcript() {
      return transcriptRing.toString();
    },

    onOutput(cb: (data: string) => void): () => void {
      outputSubscribers.add(cb);
      return () => { outputSubscribers.delete(cb); };
    },

    onExit(cb: (exitCode: number) => void): void {
      exitCallbacks.push(cb);
    },

    sendPrompt(prompt: string, timeoutMs?: number, settleDelayMsOverride?: number): Promise<{ output: string; timedOut: boolean }> {
      if (status === 'dead') {
        return Promise.reject(new Error(`Session ${id} is dead — cannot send prompt`));
      }

      return queue.add(async () => {
        if (status === 'dead') {
          throw new Error(`Session ${id} is dead — cannot send prompt`);
        }

        status = 'working';
        promptCount++;
        lastActivityAt = new Date();

        // Reset buffer for this prompt's output
        outputBuffer = '';

        // Write the prompt to the PTY
        ptyProcess.write(prompt + '\r');

        // Wait for response completion via debounce
        const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
        // PRD 012 Phase 2: per-prompt override bypasses adaptive; otherwise use adaptive delay
        const effectiveSettleDelay = settleDelayMsOverride
          ?? (adaptiveSettle ? adaptiveSettle.delayMs : settleDelayMs);
        const result = await waitForCompletion(outputBuffer, effectiveSettleDelay, timeout, (cb) => {
          dataCallback = cb;
        }, () => outputBuffer, () => getStatus() === 'dead', adaptiveSettle);

        // Extract clean response
        const output = extractResponse(result.buffer);

        // Update activity timestamp on response receipt
        lastActivityAt = new Date();

        // Restore to ready unless session died during prompt execution
        if (getStatus() !== 'dead') {
          status = 'ready';
        }

        dataCallback = null;

        return { output, timedOut: result.timedOut };
      }) as Promise<{ output: string; timedOut: boolean }>;
    },

    resize(cols: number, rows: number): void {
      try {
        ptyProcess.resize(cols, rows);
      } catch {
        // Resize failure is non-fatal — session may already be dead
      }
    },

    kill(): void {
      status = 'dead';
      dataCallback = null;
      outputSubscribers.clear();
      try {
        ptyProcess.kill();
      } catch {
        // Already dead — ignore
      }
    },

    get adaptiveSettle(): AdaptiveSettleDelay | null {
      return adaptiveSettle;
    },
  };

  return session;
}

/**
 * Wait for PTY output to settle. Completion is detected when:
 * - No new data arrives for settleDelayMs, AND
 * - The buffer contains ❯ (Claude Code's input prompt)
 *
 * PRD 012 Phase 2: When an AdaptiveSettleDelay is provided, the settle
 * timer uses the adaptive delay and detects false-positive cutoffs
 * (data arriving within 100ms of settle firing).
 *
 * Returns early if:
 * - Total timeout elapsed
 * - Session died
 */
function waitForCompletion(
  _initialBuffer: string,
  settleDelayMs: number,
  timeoutMs: number,
  setCallback: (cb: ((data: string) => void) | null) => void,
  getBuffer: () => string,
  isDead: () => boolean,
  adaptiveSettle?: AdaptiveSettleDelay | null,
): Promise<{ buffer: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setCallback(null);
    };

    const checkSettled = () => {
      const buf = getBuffer();
      // Check if buffer ends with the prompt character (possibly with trailing whitespace/ANSI)
      if (buf.includes('❯')) {
        settled = true;
        // PRD 012 Phase 2: Record settle timestamp for false-positive detection
        if (adaptiveSettle) {
          adaptiveSettle.recordSettleFired();
        }
        cleanup();
        resolve({ buffer: buf, timedOut: false });
        return;
      }
      // Not settled yet — wait for more data
    };

    const resetSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      // PRD 012 Phase 2: Use adaptive delay if available, otherwise fixed
      const delay = adaptiveSettle ? adaptiveSettle.delayMs : settleDelayMs;
      settleTimer = setTimeout(checkSettled, delay);
    };

    // Set up data callback
    setCallback((_data: string) => {
      if (isDead()) {
        cleanup();
        resolve({ buffer: getBuffer(), timedOut: false });
        return;
      }

      // PRD 012 Phase 2: Check for false-positive cutoff
      // If data arrives right after we declared settled, we cut the response short
      if (settled && adaptiveSettle) {
        adaptiveSettle.checkFalsePositive();
        // Note: the promise already resolved; the backoff applies to the next prompt
      }

      resetSettle();
    });

    // Set up total timeout
    timeoutTimer = setTimeout(() => {
      cleanup();
      resolve({ buffer: getBuffer(), timedOut: true });
    }, timeoutMs);

    // Start initial settle timer
    resetSettle();
  });
}
