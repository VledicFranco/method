---
type: spike-findings
date: 2026-04-19
package: "@anthropic-ai/claude-agent-sdk@0.2.114"
status: confirmed-viable
---

# Spike: SDK transport seam verification

## Goal

Confirm `@anthropic-ai/claude-agent-sdk` exposes a hook for routing API
calls through a custom URL or fetch, so a Cortex-aware transport can
intercept every turn for `ctx.llm` budget tracking.

## Method

1. Installed `@anthropic-ai/claude-agent-sdk@0.2.114` in
   `tmp/spike-claude-agent-sdk/`.
2. Inspected `sdk.d.ts` (5,104 lines) for transport, fetch, baseURL,
   and process-spawn hooks.
3. Examined the bundled `sdk.mjs` for env-var resolution.
4. Wrote a functional spike (`spike.mjs`) that runs `query()` against a
   local HTTP intercept server, with `ANTHROPIC_BASE_URL` injected via
   `Options.env`.

## Key findings

### 1. The SDK does NOT make HTTP calls directly

It spawns the `claude` CLI as a subprocess (the bundled JS in
`sdk.mjs`). The `Transport` interface in the SDK refers to **SDK ↔ CLI
process I/O**, not HTTP. There is no `fetch` parameter.

This invalidates the original PRD's assumption that the seam would be
fetch-shaped.

### 2. The CLI subprocess honors `ANTHROPIC_BASE_URL`

The bundled JS includes a full copy of `@anthropic-ai/sdk`. That client
reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` from the process env
when constructed (verified in `sdk.mjs`):

```js
constructor({
  baseURL: $ = N9("ANTHROPIC_BASE_URL"),
  apiKey: X = N9("ANTHROPIC_API_KEY") ?? null,
  ...
}) { ... baseURL: $ || "https://api.anthropic.com" ... }
```

`Options.env` (line 1007 of `sdk.d.ts`) passes env vars to the spawned
CLI. So the seam is: **inject `ANTHROPIC_BASE_URL` via `Options.env`
pointing at a local HTTP proxy run by the parent process.**

### 3. Functional verification — works end to end

`spike.mjs` ran `query()` with `Options.env: { ANTHROPIC_BASE_URL:
'http://127.0.0.1:<random-port>' }`. The local proxy received:

| # | Method | URL | Body size |
|---|---|---|---|
| 1 | HEAD | `/` | 0 |
| 2 | POST | `/v1/messages?beta=true` | 111,351 bytes |
| 3 | POST | `/v1/messages?beta=true` | 111,337 bytes |

The proxy returned a minimal Anthropic-shaped JSON response. The SDK
accepted it, completed normally, and emitted three messages (`system
init`, `assistant`, `result success`).

**The env-var-driven proxy approach is functional.**

### 4. Surprises

- **Initial HEAD probe** to `/` — the SDK does a connectivity check
  before the first POST. The proxy must respond (200 or even 404 is
  fine; just not hang).
- **`?beta=true` query param** on every `/v1/messages` POST. The proxy
  must match this URL pattern.
- **Request bodies are ~111 KB** even with `tools: []` — the SDK ships
  the full Claude Code system prompt (tool descriptions, tool-use
  instructions, etc.) regardless of whether tools are enabled. For
  Cortex tenants this is wasteful — we likely want to override or
  strip the system prompt via `customSystemPrompt` (line ~1500 of
  `sdk.d.ts`, needs follow-up).
- **`spawnClaudeCodeProcess` extension hook** exists (line 1665) but
  is heavyweight — would require us to re-implement the CLI. **Not
  recommended.**

### 5. Other extension hooks worth knowing

- `Options.canUseTool` — per-tool permission callback (could pre-empt
  costly tool execution at the pacta layer).
- `Options.customSystemPrompt`, `Options.appendSystemPrompt` — control
  the system prompt; probably needed to suppress the 100 KB Claude
  Code default.
- `Options.stderr` — capture CLI debug output; useful for
  observability piping into pacta `AgentEvent`.
- `Options.pathToClaudeCodeExecutable` — point at a custom CLI binary
  (mostly useful for testing).

## Updated architectural conclusion

The original PRD's `S-ANTHROPIC-WIRE-TRANSPORT` (a `fetch`-shaped seam)
**is incorrect**. Replace with a process-env-driven contract:

```typescript
export interface AnthropicSdkTransport {
  /**
   * Set up the transport before invoking the SDK. Returns env vars to
   * merge into the SDK's Options.env (typically ANTHROPIC_BASE_URL +
   * ANTHROPIC_API_KEY) and resources that must be torn down after the
   * SDK call completes.
   */
  setup(): Promise<{
    env: Record<string, string>;
    teardown: () => Promise<void>;
  }>;
}
```

The default direct-mode transport returns `{ env: {
ANTHROPIC_API_KEY: opts.apiKey ?? process.env.ANTHROPIC_API_KEY }, teardown: noop
}` — no proxy needed because the SDK talks to the real Anthropic API.

The Cortex transport returns `{ env: { ANTHROPIC_BASE_URL:
'http://127.0.0.1:<port>', ANTHROPIC_API_KEY: '<resolved>' }, teardown:
() => server.close() }` — proxy lifecycle bound to the SDK call.

## Verdict — design is viable, with one PRD revision

- **R-1 (the design's #1 risk) is resolved:** the seam exists, just at
  a different layer than originally hypothesized.
- **PRD must be updated:** S-ANTHROPIC-WIRE-TRANSPORT type changes from
  `fetch`-shaped to `setup()/teardown()/env`-shaped. Architecture
  (Wave 0) needs the proxy implementation slot.
- **New cost in scope:** the Cortex transport is more involved
  (HTTP server lifecycle, request parsing, response shaping) than a
  fetch wrapper would have been. Roughly +1 day of Wave 2.
- **System prompt suppression** (override Claude Code's 100 KB default)
  becomes a separate task in Wave 1, since otherwise every Cortex API
  call burns 25-30k tokens of unwanted system prompt.

## Files

- `tmp/spike-claude-agent-sdk/spike.mjs` — the functional spike
- `tmp/spike-claude-agent-sdk/package.json` — install fixture
- This file — write-up
