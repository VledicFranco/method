# Mandate Card — com-20260324-1751-prd-026-phase-4
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.

objective: |
  PRD 026 Phase 4: GenesisSink (30s batch, severity filter, narrow callback),
  Frontend Event Store (event-store.ts + useBridgeEvents), Phase 3 cleanup
  (remove dead JsonLineEventPersistence, channels.ts code, migrate genesis to bus).

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
  - "DR-14: Bridge modules with state/external APIs must have unit tests"
  - "DR-15: External deps through port interfaces, no direct node: imports in domains"
  - "DR-09: Tests use real fixtures, not minimal mocks"
  - "DR-03: Core has zero transport deps"

fca_anchors:
  domain: "shared/event-bus (sinks) + frontend/shared (stores/hooks)"
  layer: "L4 bridge — depends on L0-L3, must not be imported by lower"
  boundary_rule: "GenesisSink uses narrow callback, NOT SessionPool import"
  port_interfaces: "EventSink (existing), EventBus (existing)"
  boundary_map: "shared/event-bus → ports/event-bus.ts only; frontend → no backend imports"

key_files:
  - "packages/bridge/src/shared/event-bus/genesis-sink.ts — NEW GenesisSink"
  - "packages/bridge/src/shared/event-bus/in-memory-event-bus.ts — add getStats()"
  - "packages/bridge/src/server-entry.ts — wire GenesisSink, cleanup"
  - "packages/bridge/frontend/src/shared/stores/event-store.ts — NEW unified store"
  - "packages/bridge/frontend/src/shared/hooks/useBridgeEvents.ts — NEW domain hook"
  - "packages/bridge/frontend/src/domains/projects/useEventStream.ts — internal migration"

governance:
  autonomy: "M2-SEMIAUTO"
  max_decisions_before_escalate: 3
  escalation: "essence-related decisions → ALWAYS escalate"

stopping_conditions:
  continue: "gates failing but fixable, review findings actionable"
  stop_success: "all gates pass, no CRITICAL or HIGH review findings"
  stop_escalate: "blocked, budget exhausted, thrashing detected"

progress:
  phase: "B"
  iteration: "0 of 5"
  completed: []
  remaining: ["B1: GenesisSink + bus_stats", "B2: Wire + cleanup polling", "B3: Frontend event-store", "B4: Dead code cleanup"]
