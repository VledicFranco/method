# Mandate Card — com-20260410-1836-finish-fca-index-build-test
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.

completeness_rule: |
  Every function must be fully implemented. No stubs, no TODOs, no placeholders.

objective: |
  Get @method/fca-index and its MCP integration to compile and pass tests.
  All source code exists (Feature Sets A, B, C). This is dependency installation,
  test harness wiring, and mandate reconciliation — not feature work.

essence:
  purpose: "Runtime that makes formal methodologies executable by LLM agents"
  invariant: "Theory is source of truth — revise implementation, never theory"
  optimize_for: "Faithfulness > simplicity > registry integrity"

quality_gates:
  compile: "npm run build exits 0"
  test: "npm test — zero regressions"
  lint: "npx tsc --noEmit — clean"
  scope: "only fca-index, mcp, and mandate files modified"
  fca: "no boundary or layer violations"

delivery_rules:
  - "DR-03: Domain packages have zero transport deps"
  - "DR-04: MCP handlers are thin wrappers"
  - "DR-09: Tests use real YAML fixtures"
  - "DR-14: Bridge modules must have unit tests"
  - "DR-15: External deps through port interfaces"

fca_anchors:
  domain: "packages/fca-index/ (L3) + packages/mcp/ (L3)"
  layer: "L3 — depends on nothing above, must not be imported by L2"
  boundary_rule: "fca-index has zero deps on mcp or bridge"
  port_interfaces: "6 ports frozen 2026-04-08/09, 2 WARN-LEGACY"

key_files:
  - "packages/fca-index/package.json — dependency declarations"
  - "packages/fca-index/src/architecture.test.ts — 6 FCA gates"
  - "packages/mcp/src/context-tools.ts — 3 MCP tool wrappers"
  - "packages/mcp/src/context-tools.test.ts — MCP tool tests"

governance:
  autonomy: "M2-SEMIAUTO"
  max_decisions_before_escalate: 3
  escalation: "essence-related decisions → ALWAYS escalate"

stopping_conditions:
  continue: "gates failing but fixable"
  stop_success: "all gates pass, tests green, mandates updated"
  stop_escalate: "native deps fail on Windows, thrashing"

progress:
  phase: "B"
  iteration: "0 of 5"
  completed: []
  remaining: [install-deps, vitest-config, verify-build, verify-tests, verify-mcp, update-mandates]
