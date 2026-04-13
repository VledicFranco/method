/**
 * Layer registry — 4-entry static catalog.
 *
 * Wave 0 stub — C-2 populates with full narratives, lifecycles, and key concepts
 * lifted from method-1/tmp/smoke-test-visualization-design.md §L4-L1.
 */

import type { Layer } from './types.js';

export const layerRegistry: Layer[] = [];

export function getLayer(id: Layer['id']): Layer {
  const layer = layerRegistry.find((l) => l.id === id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  return layer;
}
