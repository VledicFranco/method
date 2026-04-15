/**
 * MethodologySource — Port interface for methodology data access.
 *
 * WS-1: Replaces the dual-source architecture (core YAML loader + methodts stdlib)
 * with a single port interface. All consumers (bridge, MCP) access methodology
 * data exclusively through this port.
 *
 * First implementation: StdlibSource (wraps @method/methodts stdlib catalog) —
 * stays in bridge per PRD-057 / S2 §5.3.
 * Test implementation: InMemorySource (proves port substitutability).
 *
 * PRD-064 / S7 (2026-04-14): port is **extended additively** with four
 * optional lifecycle methods (`init`, `reload`, `onChange`, `close`) and a
 * `MethodologyChange` notification payload. Core synchronous reads
 * (`list`, `getMethod`, `getMethodology`) are preserved verbatim — they are
 * the runtime hot path. Cortex-backed implementations (`CortexMethodologySource`
 * in `@method/agent-runtime`) hydrate their in-memory cache in `init()` and
 * notify invalidation listeners through `onChange()`. Stdlib/in-memory
 * sources no-op the optional methods.
 *
 * Design: DR-15 compliant — domain code accepts port via constructor injection.
 * The composition root (server-entry.ts) wires the concrete provider.
 */

import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import type { Method } from '@method/methodts';
import type { Methodology } from '@method/methodts';

// ── Port interface ──────────────────────────────────────────────

/**
 * Port interface for methodology data access.
 *
 * Core reads (list/getMethod/getMethodology) are SYNCHRONOUS — the hot path
 * on every runtime tick. Implementations MUST maintain an in-memory cache;
 * network I/O happens only in init/reload.
 *
 * Owner:     @method/runtime
 * Consumers: @method/bridge (via StdlibSource), @method/agent-runtime
 *            (via CortexMethodologySource), tests (via InMemorySource)
 * Co-designed: 2026-04-14 (S7)
 */
export interface MethodologySource {
  // ── Core reads (unchanged; synchronous) ────────────────────────
  /** List all available methodologies and their methods (catalog data). */
  list(): CatalogMethodologyEntry[];

  /** Lookup a typed Method by methodology ID and method ID. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined;

  /** Lookup a typed Methodology by ID. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined;

  // ── Lifecycle (optional; StdlibSource / InMemorySource no-op) ──

  /**
   * Hydrate the in-memory cache. Called once by the composition root
   * before the runtime serves requests.
   *   Stdlib: no-op.
   *   Cortex: reads ctx.storage, resolves stdlib inheritance, validates.
   */
  init?(): Promise<void>;

  /**
   * Force a full or targeted cache rebuild. Called by the admin write
   * path on upsert, or by the ctx.events handler when a methodology is
   * mutated on another replica. If `methodologyId` is omitted, rebuild
   * the whole cache.
   */
  reload?(methodologyId?: string): Promise<void>;

  /**
   * Subscribe to in-process invalidation events. Runtime consumers that
   * cache derived state (e.g. MethodologySessionStore) listen to this to
   * drop stale routing decisions. Returns an unsubscribe function.
   * StdlibSource / InMemorySource never emit by default.
   */
  onChange?(listener: (change: MethodologyChange) => void): () => void;

  /** Release long-lived resources (DB connections, event subscriptions). */
  close?(): Promise<void>;
}

/**
 * Payload delivered to `onChange` listeners. One union per lifecycle event
 * observable from the source:
 *
 *   - `added`   : a new methodology appeared in the catalog
 *   - `updated` : an existing methodology advanced to a new version
 *   - `removed` : a methodology was withdrawn from the catalog
 *   - `reloaded`: the entire cache was rebuilt (policy change, bulk edit)
 */
export type MethodologyChange =
  | { kind: 'added'; methodologyId: string; version: string }
  | {
      kind: 'updated';
      methodologyId: string;
      version: string;
      previousVersion: string;
    }
  | { kind: 'removed'; methodologyId: string }
  | { kind: 'reloaded'; reason: 'full' | 'bulk-admin-edit' };
