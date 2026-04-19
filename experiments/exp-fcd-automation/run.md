# exp-fcd-automation: Integration Test Run Log

**Run ID:** integration-run-1
**Date:** 2026-03-31
**Agent:** Claude Sonnet 4.6, Commission C-6 (PRD-044 Wave 4)
**Branch:** feat/prd-044-c6-integration-test

---

## Step 1 — YAML Parse Validation

**Command:**
```bash
for f in .method/strategies/s-fcd-*.yaml; do
  node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('$f','utf8')); console.log('OK: $f');"
done
```

**Output:**
```
OK: .method/strategies/s-fcd-card.yaml
OK: .method/strategies/s-fcd-commission-orch.yaml
OK: .method/strategies/s-fcd-commission-solo.yaml
OK: .method/strategies/s-fcd-design.yaml
OK: .method/strategies/s-fcd-integration-test.yaml
OK: .method/strategies/s-fcd-plan.yaml
OK: .method/strategies/s-fcd-review.yaml
OK: .method/strategies/s-fcd-surface.yaml
```

**Result:** PASS — 8/8 files parse without errors

---

## Step 2 — Architecture Gate Tests

**Command:**
```bash
cd packages/bridge && node --import tsx --test "src/shared/architecture.test.ts" 2>&1
```

**Output:**
```
TAP version 13
# Subtest: G-PORT: Domain production code uses ports, not direct imports
    ok 1 - no direct fs, js-yaml, or child_process imports in domain production code
ok 1 - G-PORT: Domain production code uses ports, not direct imports
# Subtest: G-BOUNDARY: Domains do not import sibling domain internals at runtime
    ok 1 - no runtime imports across domain boundaries
ok 2 - G-BOUNDARY: Domains do not import sibling domain internals at runtime
# Subtest: PRD-044: FCD Automation Pipeline structural invariants
    ok 1 - G-PRD044-SUBSTRATEGY: StrategyNodeConfig and SubStrategySource are exported from dag-types
    ok 2 - G-PRD044-EVENTBUS: Strategy gate payload types are exported from event-bus.ts
ok 3 - PRD-044: FCD Automation Pipeline structural invariants
# Subtest: I-9: createAgent is hoisted to session scope in print-session.ts
    ok 1 - print-session.ts contains exactly 1 createAgent( call site
ok 4 - I-9: createAgent is hoisted to session scope in print-session.ts
# Subtest: G-LAYER: Package layer ordering is respected
    ok 1 - @methodts/types (L0) does not import higher-layer packages
    ok 2 - @methodts/methodts (L2) does not import higher-layer packages
    ok 3 - @methodts/mcp (L3) does not import higher-layer packages
ok 5 - G-LAYER: Package layer ordering is respected

1..5
# tests 8
# suites 5
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 782.6351
```

**Result:** PASS — 8/8 tests, 5/5 suites, 0 failures

---

## Step 3 — Bridge:test Startup and Strategy Load

**Note:** 1Password CLI (`op`) was installed but not authenticated. The bridge
start script (`start-bridge.js`) detects `op` as available and attempts `op run`,
which fails. Workaround: start bridge directly via `tsx` with `.env` injected
manually — functionally equivalent to the `.env` fallback path.

**Command:**
```bash
source .env && INSTANCE_NAME=test PORT=3457 ROOT_DIR=test-fixtures/bridge-test \
  EVENT_LOG_PATH=/tmp/method-test-events.jsonl GENESIS_ENABLED=false MAX_SESSIONS=3 \
  node --import tsx packages/bridge/src/server-entry.ts > /tmp/bridge-test-c6-direct.log 2>&1 &
```

**Startup log (relevant lines):**
```
[cluster] Cluster disabled — skipping start
Server listening at http://127.0.0.1:3457
@methodts/bridge listening on port 3457
Scanning 12 strategy file(s) in .method/strategies
Registered 1 trigger(s) for strategy S-CORE-TEST-WATCH
Registered 1 trigger(s) for strategy S-PERF-FILE-WATCH
Registered 1 trigger(s) for strategy s-fcd-commission-orch
... (additional FCD strategies registered)
```

**Strategy definitions query:**
```bash
curl -s http://localhost:3457/api/strategies/definitions | node -e "
const chunks = []; process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(chunks).toString());
  const fcd = data.definitions.filter(d => d.id.toLowerCase().startsWith('s-fcd'));
  console.log('Total strategies:', data.definitions.length);
  console.log('FCD strategies:', fcd.length);
  fcd.forEach(s => console.log(' -', s.id, '|', s.name));
});"
```

**Output:**
```
Total strategies: 12
FCD strategies: 8
 - s-fcd-card | FCD Card Creation
 - s-fcd-commission-orch | FCD Commission — Orchestrated Multi-Commission
 - s-fcd-commission-solo | FCD Commission — Solo Implementation
 - s-fcd-design | FCD PRD Design
 - s-fcd-integration-test | FCD Integration Test — End-to-End Pipeline
 - s-fcd-plan | FCD Plan Creation
 - s-fcd-review | FCD Review Pipeline
 - s-fcd-surface | FCD Surface Co-Design
```

**Result:** PASS — 8/8 FCD strategies loaded, bridge healthy

---

## Step 4 — Stop Bridge:test

**Command:**
```bash
npm run bridge:stop:test
```

**Output:**
```
Instance profile "test" — targeting port 3457
Graceful shutdown requested — waiting for bridge to stop...
Bridge stopped gracefully
```

**Result:** PASS — clean shutdown

---

## Summary

| Gate | Check | Result |
|------|-------|--------|
| AC-1 | 8/8 YAML parse | PASS |
| AC-2 | 8/8 architecture tests | PASS |
| AC-3 | README + run log written | PASS |
| AC-4 | experiments/log/ entry written | PASS |
| AC-5 | 8/8 FCD strategies in bridge:test | PASS |

**Overall verdict: PASS** — All 5 acceptance criteria met, including the AC-5 bonus.
