/**
 * BridgeRateGovernor — Extended port interface (PRD 051 S2 extension).
 *
 * Extends pacta's base RateGovernor with admin-facing utilization
 * and leak-detection methods. Only consumed within the bridge.
 */

import type { ProviderClass, AccountUtilization } from '@method/types';
import type { RateGovernor, DispatchSlot } from '@method/pacta';

export type { RateGovernor, DispatchSlot, AcquireOptions, ObserveOutcome } from '@method/pacta';
export { SaturationError } from '@method/pacta';

export interface BridgeRateGovernor extends RateGovernor {
  utilization(providerClass: ProviderClass): readonly AccountUtilization[];
  activeSlots(): readonly DispatchSlot[];
}
