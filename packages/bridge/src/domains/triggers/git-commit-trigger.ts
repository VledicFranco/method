/**
 * PRD 018: Event Triggers — GitCommitTrigger (Phase 2a-1)
 *
 * Detects new git commits using fs.watch() on .git/refs/heads/ and
 * .git/packed-refs as notification hints, then validates via
 * `git log --oneline -1 HEAD`.
 *
 * Platform strategy:
 *   - Windows/macOS: fs.watch() primary, poll fallback
 *   - Linux: polling primary (recursive fs.watch not supported)
 */

import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { minimatch } from './glob-match.js';
import type {
  TriggerWatcher,
  TriggerType,
  GitCommitTriggerConfig,
  TimerInterface,
} from './types.js';
import { realTimers } from './types.js';

const execFile = promisify(execFileCb);

const DEFAULT_POLL_INTERVAL_MS = parseInt(
  process.env.TRIGGERS_GIT_POLL_INTERVAL_MS ?? '5000',
  10,
);

export class GitCommitTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'git_commit';

  private _active = false;
  private watchers: FSWatcher[] = [];
  private pollTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private lastSeenSha: string | null = null;
  private readonly config: GitCommitTriggerConfig;
  private readonly repoDir: string;
  private readonly pollIntervalMs: number;
  private readonly timer: TimerInterface;
  private readonly isLinux: boolean;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

  constructor(
    config: GitCommitTriggerConfig,
    repoDir: string,
    options?: {
      pollIntervalMs?: number;
      timer?: TimerInterface;
      platform?: string;
    },
  ) {
    this.config = config;
    this.repoDir = resolve(repoDir);
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timer = options?.timer ?? realTimers;
    this.isLinux = (options?.platform ?? process.platform) === 'linux';
  }

  get active(): boolean {
    return this._active;
  }

  start(onFire: (payload: Record<string, unknown>) => void): void {
    if (this._active) return;
    this.onFire = onFire;
    this._active = true;

    // Capture initial HEAD SHA to avoid firing on startup, then start watchers
    this.getCurrentSha().then((sha) => {
      if (!this._active) return; // stopped before init completed
      this.lastSeenSha = sha;

      if (this.isLinux) {
        // Linux: polling primary
        this.startPolling();
      } else {
        // Windows/macOS: fs.watch() + poll fallback
        this.startFsWatch();
        this.startPolling();
      }
    }).catch(() => {
      // If initial SHA fails, start watchers anyway — next poll will pick it up
      if (!this._active) return;
      if (this.isLinux) {
        this.startPolling();
      } else {
        this.startFsWatch();
        this.startPolling();
      }
    });
  }

  stop(): void {
    this._active = false;

    for (const w of this.watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this.watchers = [];

    if (this.pollTimerId !== null) {
      this.timer.clearTimeout(this.pollTimerId);
      this.pollTimerId = null;
    }

    this.onFire = null;
  }

  private startFsWatch(): void {
    const gitDir = join(this.repoDir, '.git');
    const refsDir = join(gitDir, 'refs', 'heads');
    const packedRefs = join(gitDir, 'packed-refs');

    // Watch .git/refs/heads/ for branch updates
    if (existsSync(refsDir)) {
      try {
        const watcher = watch(refsDir, { recursive: true }, () => {
          void this.checkForNewCommit();
        });
        watcher.on('error', () => { /* watcher error — rely on polling */ });
        this.watchers.push(watcher);
      } catch { /* fs.watch may fail — polling is the fallback */ }
    }

    // Watch .git/packed-refs for packed ref updates
    if (existsSync(packedRefs)) {
      try {
        const watcher = watch(packedRefs, () => {
          void this.checkForNewCommit();
        });
        watcher.on('error', () => { /* watcher error — rely on polling */ });
        this.watchers.push(watcher);
      } catch { /* fs.watch may fail — polling is the fallback */ }
    }
  }

  private startPolling(): void {
    const poll = (): void => {
      if (!this._active) return;
      void this.checkForNewCommit().then(() => {
        if (!this._active) return;
        this.pollTimerId = this.timer.setTimeout(poll, this.pollIntervalMs);
      });
    };

    this.pollTimerId = this.timer.setTimeout(poll, this.pollIntervalMs);
  }

  private async checkForNewCommit(): Promise<void> {
    if (!this._active || !this.onFire) return;

    const currentSha = await this.getCurrentSha();
    if (!currentSha) return;

    if (currentSha === this.lastSeenSha) return;

    const previousSha = this.lastSeenSha;
    this.lastSeenSha = currentSha;

    // Get commit details
    const commitInfo = await this.getCommitInfo(currentSha);
    if (!commitInfo) return;

    // Check branch pattern if configured
    if (this.config.branch_pattern) {
      if (!minimatch(commitInfo.branch, this.config.branch_pattern)) {
        return;
      }
    }

    this.onFire({
      branch: commitInfo.branch,
      commit_sha: currentSha,
      commit_message: commitInfo.message,
      previous_sha: previousSha,
    });
  }

  private async getCurrentSha(): Promise<string | null> {
    try {
      // Use git rev-parse HEAD for full 40-char SHA (Fix 3: F-R-8)
      const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: this.repoDir,
        timeout: 5000,
      });

      const sha = stdout.trim();
      return sha || null;
    } catch {
      return null;
    }
  }

  private async getCommitInfo(sha: string): Promise<{ branch: string; message: string } | null> {
    // Validate SHA matches full 40-char hex to prevent command injection
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      return null;
    }

    try {
      // Get current branch name (no shell, no injection risk)
      const { stdout: branchOut } = await execFile(
        'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: this.repoDir, timeout: 5000 },
      );

      // Get commit message (sha is validated above)
      const { stdout: msgOut } = await execFile(
        'git', ['log', '--format=%s', '-1', sha],
        { cwd: this.repoDir, timeout: 5000 },
      );

      return { branch: branchOut.trim(), message: msgOut.trim() };
    } catch {
      return null;
    }
  }
}
