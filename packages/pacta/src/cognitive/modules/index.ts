// SPDX-License-Identifier: Apache-2.0
/**
 * cognitive/modules/ — Stateless cognitive reasoning modules.
 *
 * Each module: (CognitiveWorkspace, input) → typed output → routed to a partition.
 * Modules are composed via algebra/ operators and executed by engine/.
 *
 * Catalog: Planner, Monitor, Reasoner, Reflector, Evaluator, Consolidator,
 *   Observer, MemoryModule (v1/v2/v3), Attention, ConflictResolver,
 *   ConstraintClassifier, MetaComposer, PersonaModule, CuriosityModule,
 *   AffectModule, Wanderer, Verifier, Router, Actor, Activation.
 */

export * from './planner.js';
export * from './monitor.js';
export * from './monitor-v2.js';
export * from './reasoner.js';
export * from './reasoner-actor.js';
export * from './reasoner-actor-v2.js';
export * from './reflector.js';
export * from './reflector-v2.js';
export * from './evaluator.js';
export * from './consolidator.js';
export * from './observer.js';
export * from './memory-module.js';
export * from './memory-module-v2.js';
export * from './memory-module-v3.js';
export * from './attention-filter.js';
export * from './priority-attend.js';
export * from './conflict-resolver.js';
export * from './constraint-classifier.js';
export * from './meta-composer.js';
export * from './persona-module.js';
export * from './curiosity-module.js';
export * from './affect-module.js';
export * from './wanderer.js';
export * from './verifier.js';
export * from './router.js';
export * from './actor.js';
export * from './activation.js';
export * from './memory-preset.js';
export * from './in-memory-dual-store.js';
export * from './sleep-api.js';
