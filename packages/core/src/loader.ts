import type { LoadedMethod, MethodologyEntry } from './types.js';

export function listMethodologies(_registryPath: string): MethodologyEntry[] {
  throw new Error('Not implemented');
}

export function loadMethodology(_registryPath: string, _methodologyId: string, _methodId: string): LoadedMethod {
  throw new Error('Not implemented');
}
