# @method/pacta-provider-ollama

Local Ollama server provider for `@method/pacta`. Implements `AgentProvider` by calling the Ollama REST API — enables offline, private, GPU-accelerated LLM inference without external API calls.

## Usage

```typescript
import { ollamaProvider } from '@method/pacta-provider-ollama';

const provider = ollamaProvider({
  baseUrl: 'http://localhost:11434',
  model: 'llama3.3',
});
```

## Features

- **Zero API cost**: runs against locally served models (Llama, Mistral, Qwen, etc.)
- **GPU inference**: leverages the host GPU via Ollama (see `docs/arch/gpu-inference-cluster.md`)
- **Full chat API**: supports system prompts, multi-turn conversation, tool schemas
- **Integration testing**: used in experiments requiring local model variants

## When to Use

Use this provider for:
- Cost-sensitive tasks where quality tradeoff is acceptable
- Privacy-sensitive workloads (data stays local)
- SLM experiments (RFC 002, RFC 005) — local fine-tuned models
- Offline development without API key access

For production methodology execution, prefer `@method/pacta-provider-anthropic` or `@method/pacta-provider-claude-cli`.
