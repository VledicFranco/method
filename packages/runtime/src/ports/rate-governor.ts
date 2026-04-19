// SPDX-License-Identifier: Apache-2.0
/**
 * RuntimeRateGovernor — Extended port interface (PRD 051 S2 extension).
 *
 * PRD-057 / S2 §4: renamed from `BridgeRateGovernor` → `RuntimeRateGovernor`.
 *
 * Extends pacta's base RateGovernor with admin-facing utilization
 * and leak-detection methods.
 */

import type { ProviderClass, AccountUtilization } from '@methodts/types';
import type { RateGovernor, DispatchSlot } from '@methodts/pacta';

export type { RateGovernor, DispatchSlot, AcquireOptions, ObserveOutcome } from '@methodts/pacta';
export { SaturationError } from '@methodts/pacta';

export interface RuntimeRateGovernor extends RateGovernor {
  utilization(providerClass: ProviderClass): readonly AccountUtilization[];
  activeSlots(): readonly DispatchSlot[];
}
