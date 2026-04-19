// SPDX-License-Identifier: Apache-2.0
/**
 * ports/ — Cluster port interfaces (PRD 039).
 *
 * Three port interfaces isolate the transport-agnostic cluster protocol (L3)
 * from concrete I/O implementations injected at the bridge layer (L4).
 *
 * DiscoveryProvider: how to find other bridge peers
 *   (Tailscale API, static seeds, gossip — implementation choice is L4's).
 * NetworkProvider: how to send/receive messages between peers
 *   (HTTP, WebSocket, TCP — implementation choice is L4's).
 * ResourceProvider: how to report local machine resources
 *   (CPU %, memory MB, session count — reads from OS, implementation is L4's).
 *
 * The cluster package never imports concrete transport libraries.
 * All I/O enters through these interfaces.
 */

export type { DiscoveryProvider } from './discovery-provider.js';
export type { NetworkProvider } from './network-provider.js';
export type { ResourceProvider } from './resource-provider.js';
