/**
 * Bounded Recursive Tower — hierarchical composition applied recursively.
 *
 * `tower(module, n)` wraps the module in n levels of hierarchical self-monitoring.
 * Each level monitors the level below it. The tower depth is bounded to prevent
 * unbounded meta-reasoning.
 *
 * Grounded in: Nelson & Narens recursive metacognition — meta-level can itself
 * be monitored by a meta-meta-level, but with diminishing returns beyond ~3 levels.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
} from './module.js';
import { CompositionError } from './module.js';
import { hierarchical } from './composition.js';

// ── Configuration ──────────────────────────────────────────────

/** Maximum allowed tower depth. Beyond this, returns diminish. */
export const MAX_TOWER_DEPTH = 3;

// ── Tower ──────────────────────────────────────────────────────

/**
 * Build a bounded recursive tower of hierarchical composition.
 *
 * `tower(module, n)` applies hierarchical composition n times, creating a
 * stack where each level monitors the level below.
 *
 * The module must accept its own monitoring signal as input (self-monitoring pattern).
 * The module's output type must extend its monitoring signal type for the
 * hierarchical composition to be valid (monitor reads target's monitoring).
 *
 * @param module - The cognitive module to tower. Must be self-monitoring:
 *                 input type = monitoring signal type (module reads its own mu).
 * @param n - Number of hierarchical levels (1 = no extra monitoring, 2+ = recursive).
 * @throws CompositionError if n > MAX_TOWER_DEPTH or n < 1.
 */
export function tower<
  Mu extends MonitoringSignal,
  O,
  S,
  Kappa extends ControlDirective,
>(
  module: CognitiveModule<Mu, O, S, Mu, Kappa>,
  n: number,
): CognitiveModule<Mu, unknown, unknown, MonitoringSignal, ControlDirective> {
  if (n < 1) {
    throw new CompositionError(`Tower depth must be >= 1, got ${n}`);
  }
  if (n > MAX_TOWER_DEPTH) {
    throw new CompositionError(
      `Tower depth ${n} exceeds MAX_TOWER_DEPTH (${MAX_TOWER_DEPTH})`,
    );
  }

  // n=1: just the module itself
  if (n === 1) {
    return module as CognitiveModule<Mu, unknown, unknown, MonitoringSignal, ControlDirective>;
  }

  // n>1: wrap in hierarchical layers recursively
  // hierarchical(monitor, target) where monitor = module, target = tower(module, n-1)
  const inner = tower(module, n - 1);

  // We need to cast here because the recursive composition produces progressively
  // more nested types. The tower's purpose is structural (depth tracking),
  // and the runtime behavior is correct — hierarchical enforces the temporal
  // sequencing regardless of the nested type wrapping.
  return hierarchical(
    module as unknown as CognitiveModule<MonitoringSignal, unknown, unknown, MonitoringSignal, ControlDirective>,
    inner,
  ) as CognitiveModule<Mu, unknown, unknown, MonitoringSignal, ControlDirective>;
}

/**
 * Get the effective depth of a towered module.
 * This is a conceptual accessor — in practice, the depth is the `n` parameter
 * passed to `tower()`. This helper validates the depth against the max.
 */
export function validateTowerDepth(n: number): void {
  if (n > MAX_TOWER_DEPTH) {
    throw new CompositionError(
      `Tower depth ${n} exceeds MAX_TOWER_DEPTH (${MAX_TOWER_DEPTH})`,
    );
  }
}
