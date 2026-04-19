// SPDX-License-Identifier: Apache-2.0
// ── Federation Configuration ────────────────────────────────────
//
// Zod-validated config for the EventRelay. Controls which events
// are federated across cluster peers and at what severity threshold.

import { z } from 'zod';

const EventSeveritySchema = z.enum(['debug', 'info', 'warning', 'error', 'critical']);

export type EventSeverity = z.infer<typeof EventSeveritySchema>;

export const EventRelayConfigSchema = z.object({
  /** Whether event federation is enabled at all. */
  federationEnabled: z.boolean().default(true),

  /** Only relay events at or above these severity levels. */
  severityFilter: z.array(EventSeveritySchema).default(['warning', 'error', 'critical']),

  /** Only relay events from these domains. Empty array means all domains pass. */
  domainFilter: z.array(z.string()).default([]),
});

export type EventRelayConfig = z.infer<typeof EventRelayConfigSchema>;
