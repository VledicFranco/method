# @methodts/pacta-provider-claude-agent-sdk

Pacta agent provider that delegates the inner agent loop to
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
while preserving pacta's `Pact` contract and middleware stack.

> **Status (April 2026):** C-1 (direct mode) shipped. C-3 (streaming)
> in progress. Cortex transport in
> `@methodts/pacta-provider-cortex/anthropic-transport` ships in C-2.

## Choosing between providers

Use **`@methodts/pacta-provider-anthropic`** when you need fine-grained
control over the inner loop (custom tool execution semantics, mid-loop
budget verdicts, per-turn middleware).

Use **`@methodts/pacta-provider-claude-agent-sdk`** when the SDK's loop
is sufficient and you want SDK improvements (streaming, sub-agents, new
reasoning modes) automatically.

## Direct mode (non-Cortex)

```ts
import { createAgent } from '@methodts/pacta';
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';

const provider = claudeAgentSdkProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // defaultModel: 'claude-sonnet-4-6',  // optional
  // maxTurns: 10,                        // optional
});

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    budget: { maxTurns: 10, maxCostUsd: 0.5 },
    scope: { allowedTools: ['Read', 'Grep'] },
  },
  provider,
});

const result = await agent.invoke({ prompt: 'Find TODO comments in src/' });
console.log(result.output);
console.log(`cost: $${result.cost.totalUsd.toFixed(4)}`);
```

## Cortex mode

For Cortex tenant apps, inject a transport from
`@methodts/pacta-provider-cortex/anthropic-transport` (C-2 commission)
that routes every SDK turn through `ctx.llm.reserve()`/`settle()`:

```ts
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';
import { cortexAnthropicTransport } from '@methodts/pacta-provider-cortex/anthropic-transport';

const provider = claudeAgentSdkProvider({
  transport: cortexAnthropicTransport(ctx, {
    handlers: {
      onBudgetWarning: (e) => ctx.log.warn(e),
      onBudgetCritical: (e) => ctx.log.error(e),
      onBudgetExceeded: (e) => ctx.log.error(e),
    },
  }),
});
```

See the `cortex-incident-triage-agent-sdk` sample (C-4) for an
end-to-end Cortex composition.

## The cost cliff

The Claude Agent SDK ships generous defaults that work great for
interactive Claude Code usage but balloon every request body for
programmatic agents. **Spike 2** measured a 199 KB → 8 KB reduction
when all suppression knobs are applied (96% reduction). This provider
applies those defaults automatically.

| Knob | Default here | If you opt in to broader behavior | Per-request cost added |
|---|---|---|---|
| `tools: []` | locked | `pact.scope.allowedTools = ['Read', 'Bash', ...]` | ~80 KB for the full Claude Code tool set |
| `settingSources: []` | locked | not exposed (override the provider's options manually) | ~76 KB for `~/.claude/settings.json` + project settings |
| `agents: {}` | locked | not exposed in v1 | varies by sub-agent definition |
| sanitized `env` | locked (PATH/HOME/TEMP/etc only) | not exposed | ~33 KB for cached MCP auth tokens |

If you find yourself needing the broader behavior (e.g. loading
`CLAUDE.md` via `settingSources: ['project']`), measure the per-request
body size and the budget impact before shipping. Forgetting any one
knob can take a per-request floor from ~8 KB to 165 KB+.

The architecture test
(`architecture.test.ts` → `G-COST`) locks in the three structural
defaults; if a future PR removes one, the test fails.

## What's mapped

The provider translates the SDK's message stream into pacta
`AgentEvent`s:

| SDK message | pacta event |
|---|---|
| `system/init` | `started` |
| `assistant` (text) | `text` |
| `assistant` (thinking) | `thinking` |
| `assistant` (tool_use) | `tool_use` |
| `user` (tool_result) | `tool_result` |
| `result` (success) | `completed` (with usage + cost) |
| `result` (error) | `error` |
| anything else | dropped |

Streaming (`Streamable.stream()`) is stubbed in C-1 and lands in C-3.

## Capabilities

```ts
{
  modes: ['oneshot'],
  streaming: true,        // surface declared; runtime lands in C-3
  resumable: false,
  budgetEnforcement: 'client',
  outputValidation: 'client',
  toolModel: 'function',
}
```

## License

Apache-2.0.
