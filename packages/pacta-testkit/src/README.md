# @method/pacta-testkit

Testing utilities for `@method/pacta`. Provides recording providers, cognitive assertions, test builders, and mock tool providers — everything needed to test pacts, agents, and cognitive compositions without live LLM calls.

## Components

| Component | Description |
|-----------|-------------|
| `RecordingProvider` | Wraps any provider and records all calls + responses for replay |
| `MockToolProvider` | Returns pre-configured tool call results — no real tool execution |
| `RecordingModule` | Records cognitive module activations for assertion in tests |
| `builders.ts` | Test builders for pacts, agents, and cognitive compositions |
| `assertions.ts` | Custom assertions: `assertToolCalled()`, `assertResponseContains()` |
| `cognitive-builders.ts` | Builders for workspace, partition, and module test fixtures |
| `cognitive-assertions.ts` | Assertions for cognitive state: `assertPartitionContains()`, `assertCycleCount()` |

## Usage

```typescript
import { RecordingProvider, assertToolCalled } from '@method/pacta-testkit';

const provider = new RecordingProvider(baseProvider);
await agent.run(provider, input);

assertToolCalled(provider, 'Read', { file_path: '/expected/path' });
```

## Design

The testkit follows the FCA test-double pattern: thin, focused fakes that capture just enough behavior for assertions. No test here exercises the real Anthropic API — all LLM interactions are intercepted and either replayed from fixtures or stubbed with pre-configured responses.
