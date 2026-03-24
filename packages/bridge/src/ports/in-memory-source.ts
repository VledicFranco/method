/**
 * InMemorySource — Test MethodologySource for port substitutability proof.
 *
 * WS-1 success criterion 6: "a 20-line InMemorySource for tests proves
 * the port interface is a real seam, not a port-shaped wrapper."
 *
 * Accepts catalog entries and typed values in the constructor.
 * No I/O, no external dependencies — pure data container.
 */

import type { MethodologySource } from './methodology-source.js';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import type { Method } from '@method/methodts';
import type { Methodology } from '@method/methodts';

export class InMemorySource implements MethodologySource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly methods: Map<string, Method<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly methodologies: Map<string, Methodology<any>>;

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
}
