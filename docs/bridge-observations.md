# Bridge Commission Observations

Empirical observations from commissioning agents via the bridge. These inform future PRDs, skill improvements, and bridge architecture decisions.

**Last updated:** 2026-03-15
**Sessions observed:** 7 commissions (PRD 006 attempt 1, PRD 006 attempt 2, PRD 008, PRD 007, AG-030, PRD 010, pv-silky portal)

---

## OBS-01: Agents don't use channel tools unless explicitly told

**Severity:** HIGH — renders PRD 008 visibility useless if not addressed
**Observed in:** PRD 006 attempt 2, PRD 007, AG-030

Despite having `bridge_progress` and `bridge_event` in their `allowedTools`, agents don't spontaneously use them. They need explicit instructions in the prompt: what to call, when to call it, and with what payload structure.

**Current mitigation:** Commission skill Section 10 now includes exact tool call instructions with payload examples.

**Root cause hypothesis:** MCP tools are available but the agent has no intrinsic motivation to use them. The channel tools are "nice to have" from the agent's perspective — they don't affect task completion. The agent optimizes for task completion, not observability.

**Potential PRD:** Auto-inject channel reporting into methodology step transitions. When `step_advance` fires and `BRIDGE_SESSION_ID` is set, automatically call `bridge_progress`. This already exists for auto-progress but only when the agent uses the methodology MCP tools — the agent itself still needs to report events.

---

## OBS-02: Agents consume initial prompt and go idle

**Severity:** MEDIUM — requires manual nudge to restart work
**Observed in:** PRD 006 attempt 2, PRD 007, AG-030

After the initial prompt is consumed, agents frequently go to `ready` state without starting work. The initial prompt is read but the agent doesn't proceed autonomously. A follow-up `bridge_prompt` nudge is needed.

**Current mitigation:** Monitor for `ready` state shortly after spawn and send a nudge prompt.

**Root cause hypothesis:** The initial prompt may be too long (2000+ tokens of instructions). The agent may be treating it as context-setting rather than an action directive. Alternatively, Claude Code's interactive mode may be waiting for a "go" signal.

**Potential fix options:**
1. End the initial prompt with a stronger action directive: "START NOW. Your first action should be to read file X."
2. Split: short initial prompt ("You are agent X, read .method/project-card.yaml") + detailed follow-up prompt with full instructions
3. Bridge-level: auto-send a "begin" prompt after the session transitions to `ready` for the first time

---

## OBS-03: PTY parser returns empty responses

**Severity:** MEDIUM — makes bridge_prompt unreliable for getting output
**Observed in:** All bridge commissions

`bridge_prompt` consistently returns `""` (empty string) or partial output (`"* Improvising..."`) regardless of what the agent actually produced. The parser looks for a `●` marker that doesn't always appear.

**Current mitigation:** PRD 008 channels provide an alternative communication path. We read progress/events instead of relying on prompt responses.

**Root cause:** The fallback parser in `packages/bridge/src/parser.ts` is best-effort. Claude Code's PTY output format is not stable — it depends on terminal width, ANSI escape sequences, and the response content.

**Potential PRD:** Replace PTY parsing with Claude Code's `--output-format json` or structured output mode if available. Alternatively, lean fully into channels and deprecate prompt response parsing for commissioned work.

---

## OBS-04: Agents route to wrong method without strong directive

**Severity:** MEDIUM — wastes time on wrong methodology path
**Observed in:** PRD 006 attempt 2 (loaded M1-COUNCIL instead of M1-IMPL)

When the commission prompt says "follow P2-SD" but doesn't explicitly state which method to use, the agent may self-route to the wrong method. The PRD 006 agent loaded M1-COUNCIL (debate method) for an implementation task.

**Current mitigation:** Commission skill Section 3 now includes an explicit routing directive: "This is task_type=implement → M1-IMPL. Do NOT use M1-COUNCIL."

**Root cause:** The agent reads the methodology's full transition function and tries to self-route. Without a strong directive, it may pick a method that matches its interpretation of the task (e.g., "I should debate the approach first").

**Potential improvement:** The commission skill could pre-call `methodology_route` and embed the routing result in the prompt, so the agent doesn't need to re-evaluate delta.

---

## OBS-05: Sub-agents commit out-of-scope files

**Severity:** MEDIUM — produces unexpected commits, hard to review
**Observed in:** PRD 008 impl (arch docs agent committed council log), PRD 004 (sub-agents deleted M1-COUNCIL content)

Sub-agents spawned by orchestrators modify files outside their declared scope. This ranges from harmless (extra council commit) to destructive (deleting registry content).

**Current mitigation:**
- Project card `role_notes.impl_sub_agent` strengthened with file-scope constraints
- Commission skill Section 9 requires explicit file-scope listing per sub-agent
- CLAUDE.md sub-agent guidelines section added
- GC-P2SD-005 resolved as EVO-P2SD-CARD-002

**Potential improvement:** Bridge-level enforcement — the spawn request could include an `allowed_paths` field, and the bridge could set up a pre-commit hook in the worktree that rejects changes outside those paths.

---

## OBS-06: Worktree isolation works but PR workflow untested

**Severity:** LOW — infrastructure exists, workflow not yet validated end-to-end
**Observed in:** PRD 007 and AG-030 (first commissions with worktree + GitHub MCP)

Worktree creation succeeds (PRD 006 C2 implemented). Agents are spawned in isolated worktrees. But the full workflow — worktree → branch → push → create PR → review → merge — has not yet completed end-to-end. PRD 007 and AG-030 are the first test.

**Validation needed:** Does the agent successfully push the worktree branch and create a PR? Does the PR diff look clean? Can we merge from the dashboard or CLI?

---

## OBS-07: bridge_prompt connection refused intermittently

**Severity:** LOW — transient, self-recovers
**Observed in:** PRD 007 nudge attempt

`bridge_prompt` returned "connection refused" on one attempt but the bridge was running (confirmed via subsequent `bridge_list`). Likely a transient Fastify request handling issue under load.

**Potential fix:** Retry logic in the MCP proxy tool for connection errors (1 retry with 1s delay).

---

## OBS-08: Multi-agent parallelism works at bridge level

**Severity:** POSITIVE — validates PRD 006 design
**Observed in:** PRD 007 + AG-030 parallel spawn

Two agents running simultaneously in separate worktrees. Bridge reports 2/2 active, no interference. Session isolation at the git level (separate worktrees) and PTY level (separate processes) is working.

**Next test:** Can both agents successfully push branches and create PRs without conflicts?

---

## OBS-09: PTY output contains parseable activity signals

**Severity:** OPPORTUNITY — could solve OBS-01 without agent cooperation
**Observed in:** All bridge commissions

The PTY stream contains structured markers for every tool call, file operation, and git command the agent performs. Claude Code outputs recognizable patterns: tool call names, file paths being read/written, bash commands being run, thinking indicators. If the bridge parsed these patterns from the PTY buffer in real-time, it could auto-emit channel events — progress on file reads, step transitions when methodology tools fire, git commits, test results — without the agent needing to call bridge_progress at all.

**Potential architecture:**
- PTY session already accumulates a raw buffer
- Add a pattern-matching layer that watches for: `mcp__method__step_advance` calls (→ progress event), `git commit` (→ progress event), `npm test` output (→ progress event with pass/fail), tool call markers (→ activity heartbeat)
- Emit to the session's channels automatically
- This is purely bridge-side — no agent changes needed

**Advantages over prompt-level instructions:**
- Works for ALL agents, including those without channel tools in allowedTools
- Works for non-methodology tasks (research, bug fixes) where step_advance isn't used
- Cannot be "forgotten" — it's infrastructure, not a prompt instruction
- Provides activity heartbeat even when agent is just reading files (solves the "is it stuck?" question)

**Risks:**
- PTY output format is not stable (ANSI escapes, terminal width, Claude Code version changes)
- Pattern matching on raw PTY is fragile — false positives/negatives likely
- May duplicate events if the agent ALSO reports via channels (need dedup)

**PRD candidate:** PRD 010 — PTY Activity Detection. Parse PTY output for tool calls, git ops, and test results. Auto-emit channel events. This would make OBS-01 and OBS-02 irrelevant — the bridge itself becomes the observer.

---

## OBS-10: Worktree → PR workflow works end-to-end

**Severity:** POSITIVE — validates PRD 006 C2 + commission skill update
**Observed in:** PRD 007 (PR #2) + AG-030 (PR #1)

Both agents successfully: created commits in worktree branches, pushed to origin, and created PRs via `mcp__github-personal__create_pull_request`. The full cycle — commission → spawn in worktree → work → PR — is now validated. PRs are reviewable by the parent agent or human.

**Remaining unknown:** PR review → merge cycle from the parent agent's perspective.

---

## OBS-11: Agents do excellent work silently

**Severity:** INSIGHT — the work quality is high, the visibility is low
**Observed in:** PRD 007 (346 lines, 13 files, all 3 phases), AG-030 (full feasibility report with architecture analysis)

Both agents produced high-quality deliverables without any progress visibility. The parent only discovered the work by checking worktrees directly. This means the commission prompt and task spec are effective — agents understand what to build. The gap is purely in observability, not capability.

**Implication:** Fixing OBS-01 (channel reporting) or implementing OBS-09 (PTY auto-detection) would make the system production-ready. The agents already deliver — we just can't see them doing it.

---

## OBS-12: SETTLE_DELAY_MS compounds into major latency for tool-heavy agents

**Severity:** MEDIUM — agent wall-clock time inflated 2x-3x by debounce overhead
**Observed in:** PRD 010 commission (4+ min "Clauding" before first visible action)

The bridge uses `SETTLE_DELAY_MS` (default 2000ms) to detect when a prompt response has finished — it waits for 2s of PTY silence before declaring the output complete. This is per-tool-call. An agent reading 9 files makes 9 tool calls, each adding 2s of idle waiting = 18s of pure overhead before any real work.

For agents that make many small tool calls (file reads, greps, edits), this compounds dramatically. A 30-second task becomes 2+ minutes.

**Mitigation applied:** Default reduced from 2000ms to 1000ms. Still configurable per-session via `settle_delay_ms` parameter on `bridge_prompt`.

**Potential improvement:** Adaptive settle delay — start at 500ms, increase if false-positive early cutoffs detected. Or detect tool-call output markers specifically and use a shorter delay for known tool patterns.

---

## OBS-13: PRD 010 agent exhibits the exact bug it's implementing a fix for

**Severity:** IRONIC/INSIGHT — meta-validation of the problem statement
**Observed in:** PRD 010 commission

The agent commissioned to implement PTY auto-detection (which solves OBS-01 and OBS-02) itself: (a) consumed the initial prompt and went idle (OBS-02), (b) produced zero channel progress reports (OBS-01), (c) required a manual nudge to start working. This is the strongest possible evidence that these are systemic issues, not prompt-quality issues. The agent was given explicit channel instructions and a strong routing directive, and still didn't comply.

**Implication:** Prompt-level solutions are definitively insufficient. Infrastructure-level detection (PRD 010) is the only reliable path.

---

## OBS-14: Cross-project commissioning works

**Severity:** POSITIVE — extends bridge utility beyond pv-method
**Observed in:** pv-silky portal scaffold (background agent, not bridge)

A background agent successfully scaffolded a full Fastify + passkey auth + PWA portal in a different repo (pv-silky). The agent read the target project's CLAUDE.md, understood the existing stack, and produced clean code that built successfully. Cross-project commissioning is viable — agents can work in repos they haven't seen before if given clear instructions.

**Note:** This was a native background agent, not a bridge commission. Bridge cross-project commissioning (setting `workdir` to a different repo) is untested but should work since the bridge just spawns Claude Code with a workdir parameter.

---

## Summary: What works vs what needs fixing

### Works well
- Bridge spawn + worktree isolation
- Channel infrastructure (progress/events/push notifications)
- Budget enforcement (depth + agent count)
- Stale detection timers
- Multi-agent parallelism
- Dashboard shows all sessions with real-time refresh
- Worktree → PR workflow end-to-end (OBS-10)
- GitHub MCP tools from within commissions
- PR review → merge from parent agent (PRD 007 + AG-030)
- Cross-project commissioning (OBS-14)

### Needs improvement (PRD candidates)
- **Auto-channel reporting** — agents never self-report, confirmed across 7 commissions (OBS-01) → PRD 010
- **Initial prompt activation** — agents stall after initial prompt, confirmed across 7 commissions (OBS-02) → PRD 010
- **PTY parser replacement** — empty responses make bridge_prompt unreliable (OBS-03)
- **Settle delay latency** — 2s debounce per tool call compounds to minutes (OBS-12) → reduced to 1s
- **Path enforcement** — sub-agents commit out-of-scope files (OBS-05, mitigated by card + skill)
- **Retry on transient errors** — bridge_prompt connection refused (OBS-07)

### Resolved by PRD 010
- **OBS-01** — auto-channel reporting via PTY watcher (7 pattern matchers, no agent cooperation needed)
- **OBS-09** — PTY auto-detection implemented and validated
- **OBS-11** — silent agents now visible via auto-detected tool calls, git commits, test results
- **OBS-13** — meta-validated: the problem was structural, infrastructure fix was correct

### Validated (this session)
- **Cross-project bridge commissioning works** — pv-silky voice commission from pv-method bridge (OBS-14 resolved)
- **PTY auto-detection works in production** — first commission with PRD 010 active showed tool_call, file_activity, idle events from pty-watcher
- **PR review → merge from parent agent** — PRs #1-3 (pv-method) + PR #1 (pv-silky) all reviewed and merged programmatically

### Resolved (this session)
- **Live output ANSI escapes** → replaced with xterm.js terminal emulator (PR #4)
- **OBS-02 (agent stalling)** → split prompt delivery (EXP-OBS02-B validated)
- **OBS-07 (connection refused)** → fetchWithRetry in MCP proxy tools (PR #5)

### Stress Test Results (5 parallel agents)

**Setup:** 5 agents fired simultaneously — 4 on pv-method, 1 on pv-silky. All with worktree isolation, split delivery, PTY auto-detection.

| Agent | Task | Completed? | PR? | Notes |
|-------|------|-----------|-----|-------|
| bravo (YAML fix) | Fix 2 registry parse errors | NO — stalled | — | No commits, no work produced |
| cedar (observations) | Update bridge-observations.md | NO — stalled | — | No commits, no work produced |
| drift (CLAUDE.md) | Refresh CLAUDE.md | YES | No PR (committed to worktree) | Cherry-picked to master |
| ember (PRD 010 status) | Mark PRD 010 implemented | NO — stalled | — | No commits, no work produced |
| flux (Tailscale docs) | Add Tailscale setup to portal | YES | [silky PR #2](https://github.com/VledicFranco/silky/pull/2) | Full deployment guide + setup script |

**Result: 2/5 completed (40%).** Split delivery improved activation (all 5 started) but 3 still stalled mid-task. The pattern: agents that needed to edit existing files (YAML, observations, PRD) stalled, while agents creating new content (CLAUDE.md update, new docs) completed.

### OBS-17: 5-agent parallel stress test — 40% completion rate

**Severity:** MEDIUM — system works but isn't reliable at scale
**Observed in:** Stress test with 5 parallel agents

Split delivery solved the activation problem (all 5 agents started) but 3 of 5 stalled mid-task without completing. The 2 that completed both involved creating/updating a single file with clear content. The 3 that stalled involved tasks requiring multiple file reads, validation steps, or complex edits.

**Possible causes:**
1. Resource contention — 5 Claude Code processes competing for API rate limits
2. Complex tasks with multiple steps more likely to stall than simple single-file tasks
3. Permission prompts blocking agents silently (undetectable from outside)

**Next investigation:** Run stress test with 3 agents instead of 5. If completion rate improves, it's resource contention. If not, it's task complexity.

### OBS-18: Agents that create new content complete more reliably than agents editing existing files

**Severity:** INSIGHT
**Observed in:** Stress test — drift (new CLAUDE.md content) and flux (new docs + script) completed, while bravo (edit YAML), cedar (edit observations), ember (edit PRD status) all stalled.

Editing existing files requires Read → think about changes → Edit, which is a multi-step tool chain. Creating new content is Write, which is a single tool call. The fewer tool call chains required, the more likely completion.
