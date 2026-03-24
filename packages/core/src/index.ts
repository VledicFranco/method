/**
 * @deprecated WS-1: @method/core is deprecated.
 *
 * - Methodology loading/listing: use @method/methodts stdlib directly
 *   (getStdlibCatalog, getMethod, getMethodology), or access via bridge HTTP API.
 *   Within the bridge package, use the MethodologySource port.
 * - Theory lookup: use @method/methodts or the bridge HTTP API.
 * - Types: use @method/types or @method/methodts directly.
 *
 * No consumers should add new imports from this package.
 */

export * from './types.js';

/** @deprecated Use @method/methodts stdlib (getStdlibCatalog, getMethod, getMethodology). */
export { listMethodologies, loadMethodology } from './loader.js';

/** @deprecated Theory lookup has been inlined into consumers. */
export { lookupTheory } from './theory.js';

// Strategy (PRD 017) — moved to @method/bridge
// PRD 020: Project Isolation Layer — moved to @method/bridge
