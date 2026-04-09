/**
 * federation/ — Event federation across cluster peers (PRD 039).
 *
 * EventRelay: decides which local BridgeEvents to relay to remote bridges.
 *   Filters by severity and domain. Prevents relay loops via `federated` flag.
 *   Zero transport dependencies — sends via the injected NetworkProvider.
 *
 * EventRelayConfig: configurable domain/severity allowlist for relay decisions.
 */

export { EventRelay } from './event-relay.js';
export type { RelayableEvent } from './event-relay.js';
export { EventRelayConfigSchema } from './event-relay.config.js';
export type { EventRelayConfig } from './event-relay.config.js';
