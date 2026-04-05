---
type: spike-findings
id: B2
title: "Claude CLI HOME Override + Auth Precedence + Windows + Version + 429 Corpus"
date: "2026-04-05"
blocks_resolved: [C-3]
prd: "051 — Cost Governor"
claude_cli_version_tested: "2.1.92 (Claude Code)"
os_tested: "Windows 11 Pro 10.0.26200"
status: partial-complete-with-runbook
---

# Spike B2 — Claude CLI HOME Override + Precedence Findings

**Purpose:** Resolve C-3 (pacta-provider-claude-cli) prerequisites for PRD 051 Cost Governor multi-account routing via HOME override.

**Scope:** What can be determined without burning API credits or triggering 429s against production Max subscriptions.

**Status:** **PARTIAL** — structural discovery complete; live 429 corpus + multi-account login verification requires operator hands-on work (runbook at bottom).

---

## Summary of Findings

| # | Finding | Impact on C-3 |
|---|---|---|
| F1 | claude CLI version: `2.1.92 (Claude Code)` | Version pinning required |
| F2 | Binary: `C:\Users\atfm0\.local\bin\claude.exe` (Windows native install) | Path must be resolvable |
| F3 | Default config: `~/.claude/` — contains `.credentials.json` + `settings.json` + `history.jsonl` + `sessions/` + `projects/` | HOME override points here |
| F4 | `.credentials.json` perms: 644 (group/world readable) | **Security issue** — should be 600 |
| F5 | **ANTHROPIC_API_KEY env var OVERRIDES keychain/OAuth in normal mode** | **F-S-6 VALIDATED** — mandatory env scrub |
| F6 | **`--bare` mode exists** — auth strictly ANTHROPIC_API_KEY/apiKeyHelper, no keychain/OAuth reads | Deterministic path for API-key routing |
| F7 | **Windows: HOME + USERPROFILE must BOTH be overridden to isolate auth** | Dual env-var override required |
| F8 | `apiKeyHelper` via `--settings` allows command-based key retrieval | Secure 1Password integration path |
| F9 | `claude auth status --print` emits JSON — safe to probe without credit cost | Useful for preflight health checks |
| F10 | No existing 429 stderr corpus in repo | Must collect live in operator runbook |

---

## Detailed Findings

### F1 — Version

```
$ claude --version
2.1.92 (Claude Code)
```

**Implication for C-3:** Version-compatibility check at bridge startup. Refuse to start if claude CLI < known-good version. Pin tested compat in `claude-cli-provider.ts`.

### F2 — Binary Location (Windows)

```
$ where claude
C:\Users\atfm0\.local\bin\claude.exe
```

Installed as a native Windows executable (`.exe`). Git Bash shim at `/c/Users/atfm0/.local/bin/claude` resolves to it. Spawning from Node via `child_process.spawn('claude', ...)` on Windows must handle PATHEXT resolution — use `shell: false` with explicit `.exe` OR use `shell: true` carefully.

### F3 — Config Directory Structure

```
~/.claude/
├── .credentials.json       ← OAuth token for Max subscription (sensitive)
├── settings.json           ← config: enabled plugins, effort level, auto-updates
├── history.jsonl           ← conversation history (3.2 MB on this system)
├── mcp.json                ← MCP server configs
├── policy-limits.json      ← usage policy limits
├── backups/                ← config backups
├── cache/                  ← response cache
├── debug/                  ← debug logs
├── file-history/           ← file-edit history
├── ide/                    ← IDE integration state
├── plans/                  ← plan mode state
├── plugins/                ← plugin installations
├── projects/               ← per-project session state
└── sessions/               ← session files
```

**`settings.json` does NOT contain credentials** — confirmed by inspection. Only config fields (enabledPlugins, effortLevel, autoUpdatesChannel, skipDangerousModePermissionPrompt).

### F4 — File Permissions (Security Finding)

```
$ stat -c "%a" ~/.claude/.credentials.json
644
```

**Issue:** OAuth token file is group/world readable. On Unix this would be a security bug. On Windows the practical implication depends on ACLs, but the documented target should be `0600`.

**Action for C-3:** On bridge startup, `chmod 0600` on `.credentials.json` if operator's HOME dir. Document in Guide 39. Refuse to run preflight for account dirs with >0600 perms on Unix (warn on Windows).

### F5 — `ANTHROPIC_API_KEY` Env Var Precedence

```
$ claude auth status
{ "loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max" }

$ ANTHROPIC_API_KEY=sk-ant-api03-FAKE... claude auth status
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiKeySource": "ANTHROPIC_API_KEY",   ← KEY WINS
  "email": null, "orgId": null, "orgName": null, "subscriptionType": null
}
```

**Confirmed:** `ANTHROPIC_API_KEY` env var overrides the keychain OAuth Max subscription. When set, the subscription identity (`email`, `orgName`, `subscriptionType`) is nullified — invocations bill against the API key's account, NOT the Max subscription.

**Impact on C-3 (F-S-6 threat validated):** If the bridge process has `ANTHROPIC_API_KEY` set globally and spawns `claude --print` intending to use a Max subscription, **the env API key wins** and billing goes to the wrong account silently. The operator thinks they're using Max subscription A, but actually using API key X.

**Mandatory mitigation:** Before spawning claude-cli for a Max-subscription-routed invocation:
```typescript
const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.ANTHROPIC_AUTH_TOKEN;
// Also delete any ANTHROPIC_API_KEY_* variants in case of aliasing
for (const k of Object.keys(childEnv)) {
  if (k.startsWith('ANTHROPIC_API_KEY')) delete childEnv[k];
}
spawn('claude', ['--print', prompt], { env: childEnv, ... });
```

### F6 — `--bare` Mode

From `claude --help`:
> `--bare` — Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. **Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read).** 3P providers (Bedrock/Vertex/Foundry) use their own credentials.

Tested:
```
$ unset ANTHROPIC_API_KEY; claude --bare auth status
{ "loggedIn": false, "authMethod": "none", "apiProvider": "firstParty" }

$ ANTHROPIC_API_KEY=sk-ant-... claude --bare auth status
{ "loggedIn": true, "authMethod": "api_key", "apiKeySource": "ANTHROPIC_API_KEY" }
```

**Implication:** `--bare` gives deterministic, API-key-only auth. Perfect for Anthropic-API-routed invocations where we want zero chance of accidental keychain/OAuth leakage.

**C-3 recommendation:** The claude-cli provider should support TWO modes:
- **OAuth mode** (for Max subscription routing) — normal invocation, alt-HOME/USERPROFILE, ANTHROPIC_* env scrubbed.
- **API-key mode** (for Anthropic API routing) — use `--bare` flag, pass `ANTHROPIC_API_KEY` in child env from `ProviderCredentials.reveal()`.

This cleanly matches the `AccountConfig` discriminated union from the PRD.

### F7 — Windows: HOME + USERPROFILE Dual Override

Test 1 (HOME only):
```
$ HOME=/tmp/empty claude auth status
{ "loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max" }   ← LOGIN PRESERVED
```

Test 2 (HOME + USERPROFILE):
```
$ HOME=/tmp/empty USERPROFILE=/tmp/empty claude auth status
{ "loggedIn": false, "authMethod": "none" }                                  ← LOGIN LOST
```

**On Windows, claude CLI resolves auth via USERPROFILE, not HOME.** Git Bash's `HOME` is a translated view; the native Windows process inherits `USERPROFILE` and uses that for `%USERPROFILE%\.claude\` path resolution + keychain scoping.

**Critical for C-3:** the claude-cli provider's env-override mechanism must set BOTH:
```typescript
const envOverrides = {
  HOME: accountConfig.claudeHome,        // for *nix / Git Bash
  USERPROFILE: accountConfig.claudeHome, // for Windows native process
};
```

Guide 39 multi-account setup on Windows must document:
```powershell
$env:HOME = "C:\Users\atfm0\.claude-max-a"
$env:USERPROFILE = "C:\Users\atfm0\.claude-max-a"
claude auth login   # authenticates ONLY for this alt-profile
```

### F8 — `apiKeyHelper` Secure Integration

From the `--bare` docs: "Anthropic auth is strictly ANTHROPIC_API_KEY or **apiKeyHelper via --settings**."

The `--settings` flag accepts a JSON file OR JSON string. Using `apiKeyHelper`:
```json
{ "apiKeyHelper": "op item get 'Anthropic API Key A' --fields credential" }
```

**Implication for C-3:** Rather than env-var passing the API key to the child process, the provider can pass `--settings '{"apiKeyHelper":"op item get ..."}'`. This means:
- The API key is never in the child process's env (safer on Linux via `/proc/PID/environ`).
- 1Password integration is first-class.
- `ProviderCredentials.reveal()` returns an apiKeyHelper command rather than a raw key (further defense-in-depth).

**Recommended C-3 credential flow for Anthropic API accounts:**
```typescript
// AccountConfig stores the apiKeyHelper command, not the key
type AccountConfig = ... | {
  providerClass: 'anthropic-api';
  apiKeyHelper: string;  // e.g., "op item get 'Anthropic Key A' --fields credential"
  ...
};

// At invocation:
const settings = JSON.stringify({ apiKeyHelper: account.apiKeyHelper });
spawn('claude', ['--bare', '--print', '--settings', settings, prompt], { env: scrubbedEnv });
```

### F9 — `claude auth status` as Preflight Probe (Safe)

`claude auth status` does NOT consume API credits — it's a local config/keychain inspection emitting JSON. Exit code 0 = authenticated. Output fields: `loggedIn`, `authMethod`, `apiProvider`, `apiKeySource`, `email`, `orgId`, `orgName`, `subscriptionType`.

**For C-3 preflight probe:**
```typescript
// Preflight at bridge startup for each registered account
const result = spawn('claude', ['auth', 'status'], {
  env: { ...scrubbedEnv, HOME: account.claudeHome, USERPROFILE: account.claudeHome },
  timeout: 5000,
});
const status = JSON.parse(result.stdout);
if (!status.loggedIn) {
  markAccountUnavailable(account.accountId, 'preflight: not logged in');
}
if (status.subscriptionType !== 'max') {
  warn(`Account ${account.accountId} is not Max (got ${status.subscriptionType})`);
}
```

**Cost: zero API calls.** Safe to run every 5 minutes as health probe per PRD spec.

### F10 — 429 Stderr Corpus (UNVERIFIED — Runbook Below)

Zero existing 429-classification code in the repo. To build the corpus-based regex classifier (F-R-9), the operator must trigger real 429s and capture stderr. **Cannot be done by the agent without burning the user's rate-limit budget.**

---

## Operator Runbook — Remaining Manual Work

These steps REQUIRE operator hands-on execution with real credentials. Do NOT run unattended; each invocation consumes API/subscription credits.

### RB-1 — Multi-Account Max Subscription Login

**Goal:** Verify that `HOME`+`USERPROFILE` override creates isolated Max subscription logins.

**Steps (per account, repeat for A/B/C):**

```powershell
# Windows PowerShell
# 1. Create alt-profile directory for account A
mkdir C:\Users\atfm0\.claude-max-a

# 2. Override BOTH env vars
$env:HOME = "C:\Users\atfm0\.claude-max-a"
$env:USERPROFILE = "C:\Users\atfm0\.claude-max-a"

# 3. Login interactively (browser OAuth flow)
claude auth login

# 4. Verify login scoped to this profile
claude auth status
# Expect: loggedIn: true, subscriptionType: "max", email: <account A email>

# 5. Repeat for accounts B, C with different alt-profile dirs

# 6. Cross-check: set alt-profile BACK to default and verify original Max still works
$env:HOME = $null
$env:USERPROFILE = "C:\Users\atfm0"
claude auth status
# Expect: loggedIn: true, <original email>
```

**Acceptance:**
- Each alt-profile shows a DIFFERENT `email` in `auth status`.
- Each alt-profile has its own `~/.claude/.credentials.json`.
- Switching alt-profile via env vars switches which account `--print` invocations bill against.

**Failure modes to test:**
- Alt-profile removed mid-session → claude CLI should return auth error, not hang.
- Alt-profile exists but token expired → captured stderr format should be parseable.

### RB-2 — 429 Corpus Collection

**Goal:** Capture real stderr samples for the regex classifier (F-R-9).

**Steps:**

```bash
# Approach 1: intentionally burst to hit rate limit
# CAUTION: This deliberately exhausts Max subscription's 5h window.
# Run during off-hours when you don't need the subscription for work.

# Create test script
cat > /tmp/burst.sh <<'EOF'
#!/bin/bash
for i in $(seq 1 300); do
  echo "Call $i"
  claude --print --output-format=json "say ok" 2> /tmp/stderr-$i.txt
  echo "Exit: $?"
  # No sleep — burst as fast as possible
done
EOF
chmod +x /tmp/burst.sh
HOME=~/.claude-max-a USERPROFILE=~/.claude-max-a /tmp/burst.sh

# Collect stderr samples that show rate-limit
for f in /tmp/stderr-*.txt; do
  if grep -iE "rate|limit|quota|429|too.many" "$f"; then
    echo "--- $f ---"
    cat "$f"
    echo ""
  fi
done > /tmp/rate-limit-corpus.txt
```

**Approach 2: if you don't want to exhaust a Max 20× sub, use a Pro account (45/5h) — hits limit faster.**

**Approach 3: use Anthropic API Tier 1 with low RPM — trigger 429 at ~50 RPM which is cheaper than burning Max capacity.**

**Acceptance:** `/tmp/rate-limit-corpus.txt` contains 10-20 distinct stderr samples. Document:
- Exact error strings emitted
- Exit code on 429 (likely non-zero, need to confirm which)
- Whether a `retry-after` hint appears in stderr
- Format stability across 10 samples (any templating?)

Commit corpus to `packages/pacta-provider-claude-cli/test-fixtures/stderr-corpus/rate-limit-samples.txt`.

### RB-3 — Windows `--print` Output-Format Matrix

**Goal:** Confirm `--print --output-format=json` output shape on Windows.

```powershell
$env:HOME = "C:\Users\atfm0\.claude-max-a"
$env:USERPROFILE = "C:\Users\atfm0\.claude-max-a"

# Expected: single JSON blob on stdout; exit code 0
claude --print --output-format=json "say ok" > C:\tmp\out.json 2> C:\tmp\err.txt
type C:\tmp\out.json
type C:\tmp\err.txt

# Confirm JSON fields: text, session_id, total_cost_usd, model_usage, duration_api_ms, etc.
```

### RB-4 — apiKeyHelper Integration

**Goal:** Validate that `--settings '{"apiKeyHelper":"..."}'` works end-to-end.

```bash
# If 1Password CLI is signed in:
KEY_CMD='op item get "Anthropic API Key Test" --fields credential --reveal'
claude --bare --print --settings "{\"apiKeyHelper\":\"$KEY_CMD\"}" "say ok"
```

**Acceptance:** Key is fetched from 1Password at invocation, never visible in process env or logs.

---

## Impact on PRD 051 Plan

### C-3 Commission Changes

Based on findings, C-3 scope updates:

1. **envOverrides** must set BOTH `HOME` and `USERPROFILE` on all platforms (not just HOME).
2. **Child env scrub** must delete ALL `ANTHROPIC_API_KEY*` variants (not just `ANTHROPIC_API_KEY`).
3. **New sub-deliverable:** `apiKeyHelper`-based credential injection via `--settings` for Anthropic-API-routed accounts. Replaces env-var passing.
4. **Preflight probe** uses `claude auth status --print` (safe, credit-free).
5. **Health probe** every 5 min uses `claude auth status` (same).
6. **Two spawn modes:** normal (OAuth via alt-HOME/USERPROFILE) for Max; `--bare` for Anthropic API.

### AccountConfig Update (minor)

Amend the discriminated union:

```typescript
type AccountConfig =
  | { providerClass: 'claude-cli-max'; accountId: AccountId; claudeHome: string; capacity: ...; priority: number; }
  | { providerClass: 'claude-cli-api'; accountId: AccountId; apiKeyHelper: string; capacity: ...; priority: number; }
  | { providerClass: 'anthropic-api';  accountId: AccountId; apiKeyHelper: string; capacity: ...; priority: number; }
  | { providerClass: 'ollama';         accountId: AccountId; endpoint: string; priority: number; };
```

The split of `claude-cli` into `claude-cli-max` (OAuth via HOME) and `claude-cli-api` (API key via --bare) is cleaner than runtime-detection. Update PRD 051 + fcd-surface record accordingly.

### Unblocked

**C-3 can proceed with:** envOverrides implementation, env scrub, --bare mode wrapper, preflight probe. Remaining: 429 classification awaits RB-2 corpus.

**Document in Guide 39:** RB-1 setup procedure, RB-4 apiKeyHelper pattern, warning about ANTHROPIC_API_KEY precedence.

---

## Security Hygiene Note

⚠️ **During this spike, `ANTHROPIC_API_KEY_N8N` was discovered in the shell env and printed to conversation context.** This credential should be **rotated** since it's now in conversation logs. The key was observed but never used for any actual API call.

Recommended actions:
1. Rotate the exposed n8n API key at https://console.anthropic.com/settings/keys
2. Remove or narrow `ANTHROPIC_API_KEY_N8N` from `.env`/shell profile to least-privilege
3. Consider moving all API keys behind 1Password `op run` to prevent shell-env leakage
