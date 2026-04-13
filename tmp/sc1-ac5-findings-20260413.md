# AC-5 Synthetic Agent Validation — Findings (2026-04-13)

**Context:** PR #163 AC-5 deferred. User now running synthetic agents via bridge.
**Tool (under test):** `mcp__method__context_query` + `mcp__method__context_detail` after PR #168 (narrow-doctext) + PR #170 (ObservabilityPort).
**Setup:** bridge running with `VOYAGE_API_KEY` in env, method MCP server registered via `.mcp.json`, agents spawned in `print` mode via `mcp__method__bridge_spawn`.

---

## Headline

**AC-5 is BLOCKED by a distinct environment/config issue**, NOT by a defect in the SC-1 work. The `mcp__method__context_query` tool is **discoverable** by spawned Claude Code sub-agents (ToolSearch successfully loads its schema) but **invocation is blocked at the permission gate**, even with `--permission-mode bypassPermissions` AND `--dangerously-skip-permissions`. The observability events from PR #170 confirm zero `fca-index.query` events were emitted during any of the 5 spawn attempts — meaning the tool handler was never actually reached.

This blocks the originally planned A/B validation but does not invalidate the SC-1 token-reduction measurements from PRs #163 / #168 / #170, which were established via the harness against the actual tool output, independent of agent behavior.

## What I did (5 spawn attempts)

| # | Session | Task | Config | Result |
|---|---|---|---|---|
| 1 | `0390255c` | "Find the event bus implementation" | default spawn_args | Correct answer, no TOOL USAGE REPORT requested — couldn't measure |
| 2 | `135e32f5` | "Find session lifecycle management" + self-report | default spawn_args, VOYAGE_API_KEY **NOT** in bridge env | Tool not registered at all. Agent fell back to Glob+Read+Grep, 7 calls, correct answer |
| 3 | `e14f28ee` | "Find strategy pipeline execution" + self-report | restarted bridge WITH `VOYAGE_API_KEY`, default spawn_args | ToolSearch loaded schema ✅. `context_query` invocation: **permission denied** ❌. Agent fell back to Glob+Grep, 8 calls, correct answer |
| 4 | `2492edae` | same task | explicit `--allowedTools mcp__method__context_query,...` | Still permission denied ❌. 1 attempt + fallback = correct answer |
| 5 | `f1623dcf` | same task | `--dangerously-skip-permissions` | Still permission denied ❌. 9 calls total (2 context_query attempts + 2 Grep denials + Glob/Read fallback). Correct answer |

**Bridge observability log:** `grep -c "fca-index" bsidl7ng8.output` returned **0**. No `fca-index.query` events across any of the spawn attempts. The tool handler was never invoked.

## Why this matters

The method MCP server's registration of `CONTEXT_TOOLS` is gated on `VOYAGE_API_KEY` at startup:

```typescript
// packages/mcp/src/index.ts:1031
...(VOYAGE_API_KEY ? CONTEXT_TOOLS : [])
```

Spawn #2 failed because the bridge was started without `.env` sourced → no `VOYAGE_API_KEY` → tools not even registered. Restarting the bridge with `set -a && source .env && set +a` fixed that.

Spawns #3–5 hit a different, deeper issue: **Claude Code's permission system rejects MCP tool invocations even with bypass flags.** The symptoms:

- `ToolSearch select:mcp__method__context_query` successfully loads the schema
- `mcp__method__context_query(...)` call returns "permission denied" / "you haven't granted it yet"
- `--permission-mode bypassPermissions` (bridge default) does not help
- `--allowedTools mcp__method__context_query,...` does not help
- `--dangerously-skip-permissions` does not help

This reproduces consistently and is independent of the SC-1 work. It appears to be a limitation of Claude Code's print mode + MCP tool handling.

## What the fallback data does tell us

Across runs 2–5, the agents reached the correct answer via Glob + Grep + Read fallback in **4–9 tool calls**. This is concrete evidence that:

- The information is findable without fca-index (expected — the PRD has always said grep/glob are viable for many queries)
- Even a strong agent using targeted fallback takes **more** calls than a single `context_query` would
- Zero source file reads happen in some cases (run #3, #4) — agents identify structure via Glob + Grep alone

Extrapolating to the SC-1 narrative:
- Pre-PR #163 (120-char excerpts): agents likely read 1–2 files per query post-query → ~2,000–4,000 tokens
- Post-PR #168 (narrow doctext + enriched top-1): if context_query WERE available, agent would act on the rendered top-1 with ~0 extra file reads → ~1,000 tokens
- Fallback (context_query UNavailable): agents use 4–9 Glob/Grep calls → ~500–2,000 tokens depending on how many Read calls follow

The SC-1 benefit captured in the harness (tool returns better data) is real; the agent-side benefit (agent reads less) remains **plausible but unmeasured** until the permission issue is resolved.

## Recommended follow-ups

1. **Investigate the MCP permission issue** (NEW, not in any prior retro).
   Symptoms reproduce with `bridge_spawn` + `print` mode + `mcp__method__*` tools. Candidates to check:
   - Does Claude Code's print mode require a specific flag to allow MCP tools? (tried: `bypassPermissions`, `dangerously-skip-permissions`, `--allowedTools mcp__...`)
   - Is there a settings.json MCP allowlist needed?
   - Is the bridge's `PactaNodeExecutor` passing Claude CLI args correctly?
   - Does pty mode (vs print) have different behavior? (Not tested — pty is interactive and harder to automate).
   - Is there a known Claude Code issue with MCP in print mode?

2. **Once the permission issue is fixed, rerun AC-5 for real.** Same 3–5 queries, measure:
   - Did agent call `context_query` first?
   - How many Read calls after?
   - Total tool call count vs the fallback baseline measured here (4–9).

3. **Register context_tools unconditionally**, not only when `VOYAGE_API_KEY` is present.
   The current gating means agents don't even see the tool exists when the project isn't configured.
   Better: always register, have the handler return a helpful error message at call time if `VOYAGE_API_KEY` is missing. Same UX pattern as "index not scanned" error.

## What this does NOT change

- PR #163, #168, #169, #170 stand. SC-1 measurement at 4,645 query-only tokens (12%) is valid — it was established by the harness against the tool's actual output, independent of agent behavior.
- Top-1 strict precision (4/4 concept queries hit the right component) stands — measured from the harness output.
- The ObservabilityPort shipped in PR #170 actively helped the investigation: the absence of `fca-index.query` events in the bridge log was what confirmed the tool handler was never reached.

## Evidence

- Bridge spawn IDs: `0390255c`, `135e32f5`, `e14f28ee`, `2492edae`, `f1623dcf`
- Bridge log: `bsidl7ng8.output` in the task output directory (fca-index event count: **0**)
- Agent self-reports: captured inline in the 5 spawn_prompt responses (run #2 onwards)
- The tool's own unit tests (PR #163/#168/#170): 216/216 still pass after PR #170

## Verdict

**AC-5 cannot be completed as originally scoped with the current Claude Code + bridge + MCP permission model.** The SC-1 improvements are valid and shipped; AC-5's role was to validate the *downstream behavior change in agents*, and that validation is currently blocked by an MCP permission issue that needs its own investigation. Recommending AC-5 status changed from **DEFERRED** to **BLOCKED-ON-MCP-PERMISSIONS**, with a follow-up item for the permission investigation.
