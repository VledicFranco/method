// SPDX-License-Identifier: Apache-2.0
/**
 * InMemorySource — Test MethodologySource for port substitutability proof.
 *
 * WS-1 success criterion 6: "a 20-line InMemorySource for tests proves
 * the port interface is a real seam, not a port-shaped wrapper."
 *
 * PRD-064 / S7: gains no-op lifecycle stubs + a controllable `onChange`
 *   trigger (`emitChange()`) so tests can simulate methodology-update
 *   fan-out without a real Cortex events port.
 *
 * Accepts catalog entries and typed values in the constructor.
 * No I/O, no external dependencies — pure data container.
 */

import type {
  MethodologySource,
  MethodologyChange,
} from './methodology-source.js';
import type { CatalogMethodologyEntry } from '@methodts/methodts/stdlib';
import type { Method } from '@methodts/methodts';
import type { Methodology } from '@methodts/methodts';

export class InMemorySource implements MethodologySource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly methods: Map<string, Method<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly methodologies: Map<string, Methodology<any>>;
  private readonly listeners = new Set<(c: MethodologyChange) => void>();

  constructor(
    private readonly catalog: CatalogMethodologyEntry[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    methods: Array<{ key: string; method: Method<any> }> = [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    methodologies: Array<{ id: string; methodology: Methodology<any> }> = [],
  ) {
    this.methods = new Map(methods.map(m => [m.key, m.method]));
    this.methodologies = new Map(methodologies.map(m => [m.id, m.methodology]));
  }

  list(): CatalogMethodologyEntry[] { return this.catalog; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined {
    return this.methods.get(`${methodologyId}/${methodId}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined {
    return this.methodologies.get(methodologyId);
  }

  // ── PRD-064 / S7 lifecycle stubs ──────────────────────────────────

  async init(): Promise<void> { /* no-op */ }
  async reload(_methodologyId?: string): Promise<void> { /* no-op */ }
  onChange(listener: (c: MethodologyChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async close(): Promise<void> { this.listeners.clear(); }

  /** Test helper — fires `change` to every registered listener. */
  emitChange(change: MethodologyChange): void {
    for (const l of this.listeners) l(change);
  }
}
