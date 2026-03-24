# Mandate Card — com-20260324-1457-prd-026-phase-2-domain-migration
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.

objective: |
  PRD 026 Phase 2: Migrate 6 remaining domains to emit through EventBus. Remove all
  legacy hook callbacks from server-entry.ts. Bus becomes the single event backbone.
  Add MCP adapter layer for backward-compatible event shapes.

essence:
  purpose: "Runtime that makes formal methodologies executable by LLM agents"
  invariant: "Theory is source of truth — revise implementation, never theory"
  optimize_for: "Faithfulness > Simplicity"

quality_gates:
  compile: "npm run build exits 0"
  test: "npm test — zero regressions"
  lint: "npx tsc --noEmit — clean"
  scope: "only files in declared scope modified"
  fca: "no boundary or layer violations"

delivery_rules:
  - "DR-03: Core has zero transport deps — bus lives at L4 bridge"
  - "DR-04: MCP tools are thin wrappers — adapter layer for legacy shapes"
  - "DR-14: Bridge modules must have unit tests covering core logic paths"
  - "DR-15: External deps through port interfaces — no direct node:fs/js-yaml in domains"

fca_anchors:
  domain: "strategies, triggers, projects, methodology, sessions (all at L4 bridge)"
  layer: "L4 bridge — depends on L0-L3, not imported by lower layers"
  boundary_rule: "Domains emit via eventBus.emit(), never direct WS or hook callbacks"
  port_interfaces: "EventBus (existing port at ports/event-bus.ts) — inject into 4 more domains"
  boundary_map: "strategies/triggers/projects/methodology → EventBus port; server-entry wires bus"

key_files:
  - "ports/event-bus.ts — EventBus port interface"
  - "shared/event-bus/in-memory-event-bus.ts — ring buffer impl"
  - "shared/event-bus/websocket-sink.ts — domain→topic mapping"
  - "server-entry.ts — composition root, legacy hooks to remove"
  - "domains/strategies/strategy-routes.ts — setOnExecutionChangeHook"
  - "domains/triggers/trigger-router.ts — onTriggerFired, onObservation, onChannelMessage"
  - "domains/projects/routes.ts — setOnEventHook, pushEventToLogWithPersistence"
  - "domains/methodology/routes.ts — appendMessage for progress events"
  - "domains/sessions/pool.ts — setObservationHook"
  - "domains/sessions/channels.ts — addOnMessageHook"

governance:
  autonomy: "M2-SEMIAUTO"
  max_decisions_before_escalate: 3
  escalation: "essence-related decisions → ALWAYS escalate"

stopping_conditions:
  continue: "gates failing but fixable, review findings actionable"
  stop_success: "all gates pass, no CRITICAL or HIGH review findings"
  stop_escalate: "blocked, budget exhausted, thrashing detected"
  stop_impossible: "spec contradicts itself, architecture can't support requirement"

progress:
  phase: "B"
  iteration: "1 of 5"
  completed: []
  remaining: [T1, T2, T3, T4, T5, T6, T7]
