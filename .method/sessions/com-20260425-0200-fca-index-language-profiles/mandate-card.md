# Mandate Card — com-20260425-0200-fca-index-language-profiles
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL: ~/.claude/skills/com/SKILL.md is the source of truth for execution.

completeness_rule: |
  Every function fully implemented. No stubs/TODOs/placeholders. Escalate if blocked.

objective: |
  Make @methodts/fca-index language-agnostic via a declarative LanguageProfile system.
  Land as v0.4.0 (additive, non-breaking). Scanner refactor only — no downstream changes.
  Bar: AC-1..AC-8 all pass; 5 built-in profiles ship; full docs.

essence:
  purpose: "Runtime that makes formal methodologies executable by LLM agents"
  invariant: "Theory is source of truth"
  optimize_for: "Faithfulness > simplicity > registry integrity"

quality_gates:
  compile: "npm run build exits 0"
  test: "npm --workspace=@methodts/fca-index test — 229 baseline + new tests, zero regression"
  lint: "npx tsc --noEmit clean"
  scope: "only packages/fca-index/, docs/prds/057*, docs/guides/40*, docs/arch/fca-index.md, docs/guides/38* modified"
  fca: "all 8 architecture gates green; no boundary/layer violations"

delivery_rules:
  - "DR-03: domain pkg has zero transport deps — fca-index already L3, do not add deps"
  - "DR-09: tests use real fixtures, not minimal mocks — fixtures in tests/fixtures/"
  - "DR-12: arch docs horizontal — one concern per file, update fca-index.md only"
  - "DR-14: bridge module tests — N/A (this is fca-index, not bridge)"
  - "DR-15: external deps via ports — scanner already uses FileSystemPort, preserve"

fca_anchors:
  domain: "scanner/ (existing) — new submodule scanner/profiles/"
  layer: "L3 — depends on no upper layer; @methodts/mcp may not be imported"
  boundary_rule: "no cross-domain imports; scanner stays self-contained"
  port_interfaces: "no new ports; ProjectScanConfig adds optional languages?: string[]"
  boundary_map: "scanner/ -> ports/ + ports/internal/; cli/manifest-reader -> ports/manifest-reader"

key_files:
  - "packages/fca-index/src/scanner/fca-detector.ts — TS-only classifyFile/classifySubDir"
  - "packages/fca-index/src/scanner/doc-extractor.ts — JSDoc + TS export extraction"
  - "packages/fca-index/src/scanner/project-scanner.ts — DEFAULT_SOURCE_PATTERNS, isComponentDir, detectLevel"
  - "packages/fca-index/src/ports/manifest-reader.ts — ProjectScanConfig (frozen interface — additive only)"
  - "packages/fca-index/src/cli/manifest-reader.ts — YAML parser to gain languages: list parsing"
  - "packages/fca-index/src/index.ts — public surface, add LanguageProfile exports"
  - "packages/fca-index/package.json — bump 0.3.0 -> 0.4.0"
  - "packages/fca-index/src/architecture.test.ts — 8 architecture gates must stay green"

governance:
  autonomy: "M2-SEMIAUTO"
  max_decisions_before_escalate: 3
  escalation: "essence-related decisions → ALWAYS escalate"
  decisions_used: 1   # PRD numbering: 055 taken; using 057

stopping_conditions:
  continue: "gates failing but fixable, review actionable"
  stop_success: "all gates pass, AC-1..AC-8 verified, no CRITICAL/HIGH findings"
  stop_escalate: "blocked, budget exhausted, thrashing 2+ iterations on same root cause"
  stop_impossible: "spec contradicts itself"

phase_a_findings:
  D1: "actual test count = 229 not 158 — use 229 as baseline"
  D2: "PRD 055 occupied — using 057"
  D3: "8 architecture gates not 4 — all must stay green"

progress:
  phase: "B-pending"
  iteration: 0
  completed: []
  remaining: ["T1+T2: profile types + 5 profiles + detector refactor",
              "T3+T4: doc-extractor + project-scanner refactor",
              "T5+T6: manifest config wiring + public surface + version bump",
              "T7: tests + fixtures (Scala, Python, Go, polyglot, markdown-only)",
              "T8: docs (PRD 057, guide 40, README rewrite, arch update)"]
