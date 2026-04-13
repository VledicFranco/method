/**
 * Layer — abstraction level in the method runtime.
 *
 * The four layers form a composition chain:
 *   Methodology (L4) selects → Method (L3) orders → Step → invokes Strategy (L2) → invokes Agent (L1)
 *
 * Frozen in Wave 0 of PRD 056. Populated by C-2 (layer registry).
 */

export interface Layer {
  /** Canonical ID used in case tags, cluster refs, routing */
  id: 'methodology' | 'method' | 'strategy' | 'agent';
  /** FCA level — displayed in layer stack row */
  level: 'L4' | 'L3' | 'L2' | 'L1';
  /** Display name */
  name: string;
  /** 1-2 paragraph narrative — renders in layer documentation section */
  narrative: string;
  /** CSS color token for badges, borders, stack rows */
  color: string;
  /** Ordered lifecycle operations — e.g., ['methodology_list', 'methodology_start', ...] */
  lifecycle: string[];
  /** Key concept pills displayed in the layer documentation */
  keyConcepts: string[];
}
