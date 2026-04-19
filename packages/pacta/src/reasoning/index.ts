// SPDX-License-Identifier: Apache-2.0
/**
 * Reasoning module — factory functions that turn ReasoningPolicy config into middleware.
 *
 * The policy is pure data (reasoning-policy.ts). These factories read the config
 * and return ReasonerMiddleware that wraps provider invoke functions.
 */

// Policy types (declarative config)
export type { ReasoningPolicy, AgentExample } from './reasoning-policy.js';

// Middleware type
export type { ReasonerMiddleware, InvokeFn } from './reasoner-middleware.js';

// Factory functions
export { reactReasoner, THINK_TOOL } from './react-reasoner.js';
export { reflexionReasoner } from './reflexion-reasoner.js';
export { fewShotInjector } from './few-shot-injector.js';
export { effortMapper, getEffortParams } from './effort-mapper.js';
export type { EffortParams } from './effort-mapper.js';
