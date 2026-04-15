/**
 * MethodologySource — Port interface for methodology data access.
 *
 * WS-1: Replaces the dual-source architecture (core YAML loader + methodts stdlib)
 * with a single port interface. All consumers (bridge, MCP) access methodology
 * data exclusively through this port.
 *
 * First implementation: StdlibSource (wraps @method/methodts stdlib catalog).
 * Test implementation: InMemorySource (proves port substitutability).
 *
 * PRD-064 / S7 (2026-04-14): port extended additively with four optional
 * lifecycle methods (`init`/`reload`/`onChange`/`close`) + `MethodologyChange`
 * notification payload. Core synchronous reads are preserved verbatim.
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
 * Core reads (list/getMethod/getMethodology) are SYNCHRONOUS — the hot
 * path on every runtime tick. Lifecycle methods are optional.
 */
export interface MethodologySource {
  /** List all available methodologies and their methods (catalog data). */
  list(): CatalogMethodologyEntry[];

  /** Lookup a typed Method by methodology ID and method ID. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined;

  /** Lookup a typed Methodology by ID. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined;

  // ── PRD-064 / S7 optional lifecycle methods ────────────────────

  /** Hydrate the in-memory cache. Stdlib / in-memory sources no-op. */
  init?(): Promise<void>;

  /** Force a full or targeted cache rebuild. */
  reload?(methodologyId?: string): Promise<void>;

  /**
   * Subscribe to in-process invalidation events. Returns an unsubscribe
   * function. Stdlib / in-memory sources never emit by default.
   */
  onChange?(listener: (change: MethodologyChange) => void): () => void;

  /** Release long-lived resources. */
  close?(): Promise<void>;
}

/** Payload delivered to `onChange` listeners (S7 §2). */
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
