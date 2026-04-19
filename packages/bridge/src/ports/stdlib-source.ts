// SPDX-License-Identifier: Apache-2.0
/**
 * StdlibSource — Production MethodologySource backed by @methodts/methodts stdlib.
 *
 * WS-1: First concrete implementation of the MethodologySource port.
 * Wraps the stdlib catalog's three lookup functions in the port interface.
 * Zero I/O, in-process — all data comes from the compiled TypeScript catalog.
 *
 * PRD-064 / S7: gains no-op lifecycle stubs (`init`/`reload`/`onChange`/
 * `close`) so consumers can uniformly invoke the optional lifecycle
 * methods without branching. StdlibSource never emits `MethodologyChange`.
 */

import type { MethodologySource, MethodologyChange } from './methodology-source.js';
import type { CatalogMethodologyEntry } from '@methodts/methodts/stdlib';
import type { Method } from '@methodts/methodts';
import type { Methodology } from '@methodts/methodts';
import {
  getStdlibCatalog,
  getMethod,
  getMethodology,
} from '@methodts/methodts/stdlib';

export class StdlibSource implements MethodologySource {
  list(): CatalogMethodologyEntry[] {
    return getStdlibCatalog();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined {
    return getMethod(methodologyId, methodId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined {
    return getMethodology(methodologyId);
  }

  // ── PRD-064 / S7 lifecycle stubs (all no-ops) ─────────────────────
  async init(): Promise<void> {
    /* stdlib catalog is compile-time — nothing to hydrate */
  }

  async reload(_methodologyId?: string): Promise<void> {
    /* stdlib never changes at runtime */
  }

  onChange(_listener: (c: MethodologyChange) => void): () => void {
    /* stdlib never emits — return a no-op unsubscribe */
    return () => {
      /* no-op */
    };
  }

  async close(): Promise<void> {
    /* no resources to release */
  }
}
