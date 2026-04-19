// SPDX-License-Identifier: Apache-2.0
/**
 * BridgeRateGovernor — Extended port interface (PRD 051 S2 extension).
 *
 * Extends pacta's base RateGovernor with admin-facing utilization
 * and leak-detection methods. Only consumed within the bridge.
 */

import type { ProviderClass, AccountUtilization } from '@methodts/types';
import type { RateGovernor, DispatchSlot } from '@methodts/pacta';

export type { RateGovernor, DispatchSlot, AcquireOptions, ObserveOutcome } from '@methodts/pacta';
export { SaturationError } from '@methodts/pacta';

export interface BridgeRateGovernor extends RateGovernor {
  utilization(providerClass: ProviderClass): readonly AccountUtilization[];
  activeSlots(): readonly DispatchSlot[];
}
