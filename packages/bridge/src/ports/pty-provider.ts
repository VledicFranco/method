import * as pty from 'node-pty';

// ── Port interface ──────────────────────────────────────────────

export interface PtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtyProcess {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number) => void) => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
}

export interface PtyProvider {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess;
}

// ── Production implementation ───────────────────────────────────

export class NodePtyProvider implements PtyProvider {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess {
    const proc = pty.spawn(file, args, options);
    return {
      onData: (cb) => { proc.onData(cb); },
      onExit: (cb) => { proc.onExit((e) => cb(e.exitCode)); },
      write: (data) => { proc.write(data); },
      resize: (cols, rows) => { proc.resize(cols, rows); },
      kill: (signal) => { proc.kill(signal); },
      get pid() { return proc.pid; },
    };
  }
}
