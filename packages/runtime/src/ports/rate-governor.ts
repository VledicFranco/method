/**
 * RuntimeRateGovernor — Extended port interface (PRD 051 S2 extension).
 *
 * PRD-057 / S2 §4: renamed from `BridgeRateGovernor` → `RuntimeRateGovernor`.
 *
 * Extends pacta's base RateGovernor with admin-facing utilization
 * and leak-detection methods.
 */

import type { ProviderClass, AccountUtilization } from '@method/types';
import type { RateGovernor, DispatchSlot } from '@method/pacta';

export type { RateGovernor, DispatchSlot, AcquireOptions, ObserveOutcome } from '@method/pacta';
export { SaturationError } from '@method/pacta';

export interface RuntimeRateGovernor extends RateGovernor {
  utilization(providerClass: ProviderClass): readonly AccountUtilization[];
  activeSlots(): readonly DispatchSlot[];
}
