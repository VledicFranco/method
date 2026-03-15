import * as pty from 'node-pty';
import PQueue from 'p-queue';
import { extractResponse } from './parser.js';

export type SessionStatus = 'initializing' | 'ready' | 'working' | 'dead';

export interface PtySession {
  readonly id: string;
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
  sendPrompt(prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }>;
  kill(): void;
}

export interface SpawnOptions {
  id: string;
  workdir: string;
  claudeBin?: string;
  settleDelayMs?: number;
  initialPrompt?: string;
  spawnArgs?: string[];
}

const DEFAULT_SETTLE_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

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

  // PRD 007: Full transcript buffer + live output subscribers
  const MAX_TRANSCRIPT_SIZE = parseInt(process.env.MAX_TRANSCRIPT_SIZE_BYTES ?? '5242880', 10);
  let transcriptBuffer = '';
  const outputSubscribers = new Set<(data: string) => void>();

  // Listen for PTY data
  ptyProcess.onData((data: string) => {
    outputBuffer += data;

    // PRD 007: Accumulate transcript (with size cap)
    transcriptBuffer += data;
    if (transcriptBuffer.length > MAX_TRANSCRIPT_SIZE) {
      transcriptBuffer = transcriptBuffer.substring(transcriptBuffer.length - MAX_TRANSCRIPT_SIZE);
    }

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
  ptyProcess.onExit(() => {
    status = 'dead';
    dataCallback = null;
  });

  const session: PtySession = {
    id,

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
      return transcriptBuffer;
    },

    onOutput(cb: (data: string) => void): () => void {
      outputSubscribers.add(cb);
      return () => { outputSubscribers.delete(cb); };
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
        const effectiveSettleDelay = settleDelayMsOverride ?? settleDelayMs;
        const result = await waitForCompletion(outputBuffer, effectiveSettleDelay, timeout, (cb) => {
          dataCallback = cb;
        }, () => outputBuffer, () => getStatus() === 'dead');

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
  };

  return session;
}

/**
 * Wait for PTY output to settle. Completion is detected when:
 * - No new data arrives for settleDelayMs, AND
 * - The buffer contains ❯ (Claude Code's input prompt)
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
): Promise<{ buffer: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setCallback(null);
    };

    const checkSettled = () => {
      const buf = getBuffer();
      // Check if buffer ends with the prompt character (possibly with trailing whitespace/ANSI)
      if (buf.includes('❯')) {
        cleanup();
        resolve({ buffer: buf, timedOut: false });
        return;
      }
      // Not settled yet — wait for more data
    };

    const resetSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(checkSettled, settleDelayMs);
    };

    // Set up data callback
    setCallback((_data: string) => {
      if (isDead()) {
        cleanup();
        resolve({ buffer: getBuffer(), timedOut: false });
        return;
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
