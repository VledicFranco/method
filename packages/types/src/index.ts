/**
 * @method/types — Canonical shared types for the Method runtime.
 *
 * L0 package: no runtime dependencies. All higher layers (methodts, pacta,
 * mcp, bridge) may import from here. This package must NEVER import from
 * any other @method/* package.
 */

export type {
  SlotId,
  AccountId,
  ProviderClass,
  InvocationSignature,
  CostBand,
  AccountCapacity,
  AccountUtilization,
} from './cost-governor.js';
