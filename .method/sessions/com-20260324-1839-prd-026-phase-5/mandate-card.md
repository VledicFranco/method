# Mandate Card — com-20260324-1839-prd-026-phase-5
# Pulsed every 5 minutes. Do not edit manually.
# PROTOCOL REFERENCE: .claude/skills/com/SKILL.md

objective: |
  PRD 026 Phase 5 (final): EventConnector interface, WebhookConnector POC,
  declarative env config, arch doc, CLAUDE.md update, verify 8 success criteria.
  Bundle cleanup: remove dead JsonLineEventPersistence, ChannelEventTrigger, genesis polling.

essence:
  purpose: "Runtime that makes formal methodologies executable by LLM agents"
  invariant: "Theory is source of truth — revise implementation, never theory"
  optimize_for: "Faithfulness > simplicity > registry integrity"

quality_gates:
  compile: "npm run build exits 0"
  test: "npm test — zero regressions"
  lint: "npx tsc --noEmit — clean"
  scope: "only files in declared scope modified"
  fca: "no boundary or layer violations"

delivery_rules:
  - "DR-14: Bridge modules must have unit tests"
  - "DR-15: External deps through port interfaces"
  - "DR-12: Arch docs one file per concern in docs/arch/"
  - "DR-03: Core has zero transport deps"

fca_anchors:
  domain: "shared/event-bus (connectors) + ports (interface) + server-entry (config)"
  layer: "L4 bridge"
  boundary_rule: "Connectors are EventSink extensions — registered at composition root only"
  port_interfaces: "EventSink (existing) → EventConnector (new, extends EventSink)"

key_files:
  - "packages/bridge/src/ports/event-bus.ts — EventConnector interface"
  - "packages/bridge/src/shared/event-bus/webhook-connector.ts — NEW"
  - "packages/bridge/src/server-entry.ts — env config + connector wiring"
  - "docs/arch/event-bus.md — NEW arch doc"

governance:
  autonomy: "M2-SEMIAUTO"
  max_decisions_before_escalate: 3

progress:
  phase: "B"
  iteration: "0 of 5"
  completed: []
  remaining: ["B1: EventConnector interface", "B2: WebhookConnector", "B3: Config wiring", "B4: Cleanup backlog", "B5: Docs + PRD completion"]
