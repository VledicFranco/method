# @methodts/pacta-provider-claude-agent-sdk

Pacta agent provider that delegates the inner agent loop to
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
while preserving pacta's `Pact` contract and middleware stack.

> **Status: Wave 0 surface only.** Direct-mode implementation lands in
> Wave 1 (commission C-1). Streaming in Wave 2 (C-3). Cortex transport
> in `@methodts/pacta-provider-cortex/anthropic-transport` ships in
> Wave 2 (C-2). See
> [`fcd-plan-20260419-2300-pacta-claude-agent-sdk/realize-plan.md`](../../.method/sessions/fcd-plan-20260419-2300-pacta-claude-agent-sdk/realize-plan.md).

## Choosing between providers

Use **`@methodts/pacta-provider-anthropic`** when you need fine-grained
control over the inner loop (custom tool execution semantics, mid-loop
budget verdicts, per-turn middleware).

Use **`@methodts/pacta-provider-claude-agent-sdk`** when the SDK's loop
is sufficient and you want SDK improvements (streaming, sub-agents, new
reasoning modes) automatically.

## License

Apache-2.0.
