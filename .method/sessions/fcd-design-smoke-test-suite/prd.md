---
type: prd
title: "Methodology Smoke Test Suite"
prd: "055"
date: "2026-04-09"
status: draft
domains: [smoke-test]
surfaces: []
---

# Methodology Smoke Test Suite

PRD 055. See docs/prds/055-smoke-test-suite.md for the full specification.

## Summary

New `@methodts/smoke-test` package (L4) — a web app + Playwright test suite that validates every feature of the strategy, methodology, and method abstractions through 35 end-to-end smoke test cases.

## Key Decisions

1. **Leaf consumer** — no new cross-domain ports. Package consumes methodts, pacta, pacta-testkit.
2. **Dual mode** — mock (testkit providers, CI-safe) and live (real Anthropic API, human verification).
3. **Web app first** — the browser UI IS the test harness. Playwright drives it.
4. **Feature matrix** — 35 test cases mapping 1:1 to the feature inventory.

## Wave Plan

- Wave 0: Package scaffold + 25 strategy YAML fixtures + 6 method sequences + test case registry
- Wave 1: Mock executor + verification engine + fixture parse tests
- Wave 2: Web app (3-panel: browser, execution, verification)
- Wave 3: Playwright suite + CI integration
