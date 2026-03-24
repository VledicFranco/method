# Mandate Card — com-20260324-1142-prd-026-universal-event-bus
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.

objective: |
  Implement PRD 026 Phase 1: EventBus port interface, InMemoryEventBus, WebSocketSink,
  and migrate sessions domain to emit through the bus. Foundation for unified event backbone.

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
  - "DR-12: Architecture docs follow horizontal pattern — one concern per file"

fca_anchors:
  domain: "ports/ + shared/event-bus/ (infrastructure)"
  layer: "L4 bridge — depends on L0-L3, not imported by lower layers"
  boundary_rule: "Domains emit via eventBus.emit(), never direct WS or persistence calls"
  port_interfaces: "EventBus (new port in ports/event-bus.ts)"
  boundary_map: "sessions → EventBus port; server-entry wires bus + sinks"

key_files:
  - "ports/event-bus.ts — port interface (BridgeEvent, EventBus, EventSink, EventFilter)"
  - "shared/event-bus/in-memory-event-bus.ts — ring buffer implementation"
  - "shared/event-bus/websocket-sink.ts — wraps WsHub for event push"
  - "server-entry.ts — composition root wiring"
  - "domains/sessions/pool.ts — session lifecycle event emission"
  - "shared/websocket/hub.ts — existing WsHub (WebSocketSink target)"

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
  phase: "C"
  iteration: "2 of 5"
  completed: [T1, T2, T3, T4, T5, "review fixes"]
  remaining: []
