// SPDX-License-Identifier: Apache-2.0
/**
 * EventBus — Port interface for the Universal Event Bus (PRD 026).
 *
 * PRD-057 / S2 §4: The port interfaces moved to `@methodts/runtime/ports`.
 * This file is now a **shim**: it re-exports the runtime interfaces and
 * provides a back-compat type alias `BridgeEvent = RuntimeEvent` during
 * the migration window. Event `type` strings are unchanged — wire format
 * is stable.
 *
 * New bridge code should import from `@methodts/runtime/ports`. Existing
 * bridge code continues to use `BridgeEvent` via this alias; the alias
 * is removed in a follow-up once PRD-058 has consumed the new names.
 */

export type {
  RuntimeEvent,
  RuntimeEventInput,
  EventBus,
  EventSink,
  EventConnector,
  EventFilter,
  EventSubscription,
  ConnectorHealth,
  EventDomain,
  EventSeverity,
  StrategyGateAwaitingApprovalPayload,
  StrategyGateApprovalResponsePayload,
} from '@methodts/runtime/ports';

import type { RuntimeEvent, RuntimeEventInput } from '@methodts/runtime/ports';

/**
 * Back-compat alias — bridge-internal code uses `BridgeEvent` throughout.
 * PRD-057 / S2 §4: preserved during migration; removed post PRD-058.
 */
export type BridgeEvent = RuntimeEvent;

/**
 * Back-compat alias — input shape for EventBus.emit().
 * PRD-057 / S2 §4: preserved during migration; removed post PRD-058.
 */
export type BridgeEventInput = RuntimeEventInput;
