/**
 * StdlibSource — Production MethodologySource backed by @method/methodts stdlib.
 *
 * WS-1: First concrete implementation of the MethodologySource port.
 * Wraps the stdlib catalog's three lookup functions in the port interface.
 * Zero I/O, in-process — all data comes from the compiled TypeScript catalog.
 */

import type { MethodologySource } from './methodology-source.js';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import type { Method } from '@method/methodts';
import type { Methodology } from '@method/methodts';
import {
  getStdlibCatalog,
  getMethod,
  getMethodology,
} from '@method/methodts/stdlib';

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
}
