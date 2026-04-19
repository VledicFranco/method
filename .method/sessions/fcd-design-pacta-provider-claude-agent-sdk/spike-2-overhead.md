---
type: spike-findings
date: 2026-04-19
package: "@anthropic-ai/claude-agent-sdk@0.2.114"
parent: spike-findings.md
status: confirmed-mitigated
---

# Spike 2: Per-request overhead — what's actually in the 100KB?

## Goal

Spike 1 surfaced a concern (R-1b): every SDK API call ships a ~111 KB
request body even with `tools: []`. If that's intrinsic, Cortex tenants
pay the cost on every turn. This spike measures where the bulk lives,
which knobs reduce it, and what the achievable floor is.

## Method

Three runs against the local intercept proxy, parsing each captured
`POST /v1/messages?beta=true` body to break down system prompt vs.
tools vs. messages contribution. Then a fourth sanitized-env run to
check whether host-environment state was leaking in.

## Results

### Run A — knob comparison

| Scenario | Total body | System prompt | Tools (count) | Tools size |
|---|---|---|---|---|
| **1.** baseline | 199 KB | 147 chars | 123 | 157 KB |
| **2.** `systemPrompt: '...'` | 199 KB | 190 chars | 123 | 157 KB |
| **3.** + `tools: []` | 111 KB | 190 chars | 95 | 77 KB |
| **4.** + `settingSources: []` | 35 KB | 190 chars | 23 | 33 KB |

**Surprise #1:** the `system` field is *already tiny by default* — the
SDK ships only ~150 chars (a billing-tracking header), not a Claude
Code system prompt. Original R-1b was wrong about where the bulk lives.

**Surprise #2:** `tools: []` doesn't actually disable all tools — it
disables built-in tools but MCP-server tools and account-attached
tools persist.

**Surprise #3:** `settingSources: []` (explicit empty) drops 76 KB
even though the docs say "When omitted or empty, no filesystem
settings are loaded" — they aren't equivalent in practice.

### Run B — what are the 23 stuck tools?

Inspection of the tools at the "isolation floor":

```
mcp__claude_ai_Gmail__authenticate
mcp__claude_ai_Gmail__complete_authentication
mcp__claude_ai_Google_Calendar__authenticate
mcp__claude_ai_Google_Calendar__complete_authentication
mcp__claude_ai_Google_Drive__authenticate
mcp__claude_ai_Google_Drive__complete_authentication
mcp__claude_ai_Miro__authenticate
mcp__claude_ai_Miro__complete_authentication
mcp__claude_ai_Slack__slack_create_canvas
... (12 more Slack tools)
mcp__claude_ai_T1_Cortex__authenticate
mcp__claude_ai_T1_Cortex__complete_authentication
```

**These are MCP servers attached to my Claude.ai account**, leaked into
the SDK invocation via cached OAuth state. Not intrinsic to the SDK.

The "system" field at this floor was actually:
```
x-anthropic-billing-header: cc_version=2.1.114.7be; cc_entrypoint=sdk-cli; cch=5bbe2;
```
A 90-char tracking string, not a Claude Code system prompt at all.

### Run C — sanitized env confirms the leak hypothesis

Stripping the env to bare essentials (no Claude.ai auth, no
`CLAUDE_CONFIG_DIR`, only `PATH`/`HOME`/`USERPROFILE`/etc), plus
`tools: []`, `settingSources: []`, `agents: {}`:

```
body: 8,488 bytes
tools: 3
  - Monitor
  - PushNotification
  - RemoteTrigger
```

The remaining 3 tools are inherited from the **host Claude Code
session that's running this spike** (these are real tool names from
this very session). In a Cortex Lambda/container, no host session
exists, so the floor would be even lower.

## Conclusions

| Cost source | Size in baseline | After mitigation | Mitigated by |
|---|---|---|---|
| System prompt | ~150 chars | ~150 chars | (already minimal — just a billing header) |
| Built-in tools | ~80 KB | 0 | `tools: []` |
| Filesystem settings (CLAUDE.md, MCP) | ~76 KB | 0 | `settingSources: []` |
| Account-attached MCP servers | ~33 KB | 0 | sanitized `env` (no cached auth) |
| Host-session inherited tools | ~? | small | Cortex deployment naturally lacks a host session |

**True per-request floor for a Cortex tenant: ~5-8 KB** — the messages
payload + minimal system tracking + maybe 1-2 tools the tenant
explicitly registered. **96% reduction from baseline.**

## Updated R-1b

R-1b is **mitigated, not eliminated**. Every Cortex tenant invocation
must use the full set of suppression knobs:

```typescript
{
  systemPrompt: '...',               // override the (negligible) default
  tools: [],                         // suppress built-in tools
  settingSources: [],                // explicit empty (NOT omitted)
  agents: {},                        // no sub-agents unless declared
  env: cleanEnv({                    // sanitized env, no cached auth
    ANTHROPIC_BASE_URL: '<proxy>',
    ANTHROPIC_API_KEY: '<resolved>',
  }),
}
```

The pacta provider's factory MUST apply these defaults (overridable per
pact for tenants that opt in to broader behavior). Forgetting any one
knob can balloon the per-request cost by 30 KB to 165 KB.

## Action items for the PRD

1. **`claudeAgentSdkProvider` defaults** — apply all five knobs above
   automatically. Tenants override per-pact only if they want broader
   capabilities. Prevents accidental cost ballooning.
2. **G-COST gate** (new) — architecture test that the provider's
   default `Options` object passes `tools: []`, `settingSources: []`,
   `agents: {}`. Catches regressions if a future PR removes a default.
3. **Conformance row** — measure per-request body size against a
   ceiling (e.g., 12 KB excluding tenant-supplied tools/messages).
4. **Tenant warning** — README documents the cost cliff: "if you
   `settingSources: ['user']` to load CLAUDE.md, expect +75 KB per
   request — measure your budget impact."

## Files

- `tmp/spike-claude-agent-sdk/spike-systemprompt.mjs` — knob comparison
- `tmp/spike-claude-agent-sdk/spike-tools-floor.mjs` — tool-name dump
- `tmp/spike-claude-agent-sdk/spike-clean-env.mjs` — sanitized env test
- This file — write-up
