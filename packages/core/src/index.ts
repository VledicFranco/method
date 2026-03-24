/**
 * @deprecated WS-1: @method/core is deprecated.
 *
 * - Methodology loading/listing: use MethodologySource port (StdlibSource) from @method/bridge/ports
 * - Theory lookup: inlined into @method/mcp/src/theory.ts
 * - Types: use @method/types or @method/methodts directly
 *
 * No consumers should add new imports from this package.
 */

export * from './types.js';

/** @deprecated Use MethodologySource.list() via StdlibSource instead. */
export { listMethodologies, loadMethodology } from './loader.js';

/** @deprecated Inlined into @method/mcp. Import from @method/mcp/src/theory.js instead. */
export { lookupTheory } from './theory.js';

// Strategy (PRD 017) — moved to @method/bridge
// PRD 020: Project Isolation Layer — moved to @method/bridge
