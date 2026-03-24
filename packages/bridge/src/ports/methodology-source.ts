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
 * Methods:
 *   list()                          — all methodologies with their methods
 *   getMethod(methodologyId, id)    — lookup a typed Method by compound key
 *   getMethodology(id)              — lookup a typed Methodology by ID
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
}
