# EXP-OBS02: Initial Prompt Length vs Auto-Activation

**Date:** 2026-03-15
**Observation:** OBS-02 — agents consume initial prompt and go idle
**Status:** Complete — threshold identified

---

## Hypothesis

Agent stalling after initial prompt is correlated with prompt length. Long prompts cause agents to start but stop mid-task.

## Method

Spawned 4 agents in parallel with varying prompt lengths. All had the auto-nudge suffix ("Begin executing immediately..."). Measured: did the agent auto-activate, and did it produce a completion event?

## Results

| Trial | ~Tokens | Prompt Type | Auto-started? | Completed? | Time to complete |
|-------|---------|------------|---------------|------------|-----------------|
| T1 | ~30 | 1 sentence: run tests, report | YES | YES | ~20s |
| T2 | ~150 | 3 steps: read file, grep, report | YES | YES | ~25s |
| T3 | ~500 | Mini-commission: 6 steps, essence, delivery rules | YES (briefly `working`) | NO — went `ready` | stalled |
| T4 | ~1500 | Full commission: methodology, routing, sub-agents, retro, git workflow | YES (briefly `working`) | NO — went `ready` | stalled |

## Analysis

**Threshold:** Between ~150 and ~500 tokens. Prompts under ~150 tokens work reliably. Prompts over ~500 tokens cause the agent to start (transitions to `working`), do some thinking, then go idle (`ready`) without completing the task.

**Key observation:** T3 and T4 both showed `working` state initially — the agent DID start processing. It then dropped back to `ready` without producing outputs. This is NOT a prompt paste garbling issue (the prompt was received). The agent starts reasoning but gives up or gets confused before acting.

**Possible causes:**
1. **Claude Code's initial prompt handling** — long initial prompts may be treated as context-setting rather than action requests, even with "Begin immediately" suffix
2. **Tool permission interaction** — the agent may hit a permission prompt for the first tool call, which blocks it silently in PTY
3. **Context overload** — too much instruction in one shot causes the agent to plan indefinitely rather than act
4. **TUI rendering interference** — the initial prompt paste interacts with Claude Code's TUI rendering (cursor positioning, line wrapping) in ways that corrupt the perceived instruction

## Recommendation

**Split prompt delivery:** Instead of one large initial prompt, use:
1. Short initial prompt (~50 tokens): "You are agent X for project Y. Wait for your task."
2. Follow-up `bridge_prompt` with the full commission (~1500 tokens)

This leverages the finding that short initial prompts activate reliably, while delivering the full instruction set as a normal prompt turn (which agents handle well in interactive mode).

**Implementation:** Modify `pool.ts` to split initial prompts over the threshold:
```
if (initialPrompt.length > SPLIT_THRESHOLD) {
  // Send short activation prompt as initial
  // Queue full prompt as follow-up after session is ready
}
```

## EXP-OBS02-B: Split Delivery Validation

**Date:** 2026-03-15
**Status:** PASS — split delivery fixes the stalling problem

### Method

Implemented split prompt delivery in pool.ts: prompts >500 chars are split into a short activation ("You will receive your full task instructions in the next message") + follow-up with full commission 3s later.

Tested with a ~1500 token commission prompt (same length as T4 which stalled).

### Result

| Metric | T4 (monolithic) | EXP-OBS02-B (split) |
|--------|-----------------|---------------------|
| Auto-activated | YES (briefly) | YES |
| Tool calls | 0 | 21+ |
| Completed | NO — stalled | YES — full health report |
| Time | stalled indefinitely | ~4 minutes |

### Conclusion

**Split delivery solves OBS-02.** The root cause was long initial prompts causing Claude Code to treat the instruction as context rather than action. Short activation prompt reliably triggers action mode, then the full commission arrives as a normal interactive prompt which Claude Code handles correctly.

**Implementation:** `pool.ts` splits at 500 chars. Short init activates agent, full commission queued as follow-up via p-queue with 3s delay. No agent changes needed — purely bridge-side.
