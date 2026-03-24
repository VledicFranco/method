# Mandate Card — com-20260324-1607-prd-026-phase-3-sinks-replay
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.

objective: |
  Make events durable. Add PersistenceSink (JSONL write-ahead batching via FileSystemProvider),
  ChannelSink (replaces appendMessage channels), event replay on restart, and unified /api/events.
  Remove all legacy persistence and channel systems.

essence:
  purpose: "Runtime that makes formal methodologies executable by LLM agents"
  invariant: "Theory is source of truth — implementation revised, never theory"
  optimize_for: "Faithfulness > simplicity > registry integrity"

quality_gates:
  compile: "npm run build exits 0"
  test: "npm test — zero regressions"
  lint: "npx tsc --noEmit — clean"
  scope: "only files in declared scope modified"
  fca: "no boundary or layer violations"

delivery_rules:
  - "DR-09: Tests use real YAML fixtures, not minimal mocks"
  - "DR-14: Bridge modules must have unit tests covering core logic paths"
  - "DR-15: External deps through port interfaces, no direct fs/yaml imports in domains"
  - "DR-03: Core has zero transport dependencies"
  - "DR-04: MCP handlers are thin wrappers"

fca_anchors:
  domain: "shared/event-bus (existing infrastructure)"
  layer: "L4 — depends on L0-L3, must not be imported by anything"
  boundary_rule: "Sinks registered at composition root only, domains access via injection"
  port_interfaces: "EventBus (extend with importEvent), FileSystemProvider (existing)"
  boundary_map: "sessions/ reads from ChannelSink, PersistenceSink uses FileSystemProvider"

key_files:
  - "ports/event-bus.ts — EventBus port interface"
  - "shared/event-bus/in-memory-event-bus.ts — bus implementation"
  - "sessions/channels.ts — legacy channel system (to remove)"
  - "sessions/pty-watcher.ts — needs bus migration"
  - "sessions/routes.ts — channel REST endpoints"
  - "projects/routes.ts — legacy event persistence"
  - "server-entry.ts — composition root"

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
  iteration: "0 of 5"
  completed: []
  remaining: ["B1: importEvent+PersistenceSink", "B2: ChannelSink+pty-watcher", "B3: wire routes+/api/events", "B4: remove legacy systems"]
