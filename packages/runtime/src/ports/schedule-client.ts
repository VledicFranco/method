/**
 * ScheduleClient — minimal slice of ctx.schedule consumed by the runtime.
 *
 * PRD-062 / S5 §2.3. Frozen: 2026-04-14.
 *
 * Cortex's EventBridge-backed scheduler is structurally compatible with
 * this port (Cortex PRD-075). The runtime consumes it via
 * `ScheduledPact.bind/unbind` — tenant apps that pre-declare schedules
 * in the manifest never touch this port directly.
 */
export interface ScheduleClient {
  /**
   * Register a named schedule. On each `cron` tick, the scheduler
   * enqueues a job of `def.job` with `def.payload`.
   */
  create(
    name: string,
    def: { cron: string; job: string; payload: unknown },
  ): Promise<void>;

  /** Delete a named schedule. Idempotent. */
  delete(name: string): Promise<void>;

  /** List registered schedules. */
  list(): Promise<Array<{ name: string; cron: string }>>;
}
