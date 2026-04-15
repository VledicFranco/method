---
title: "@method/pacta-testkit"
scope: package
layer: L3
contents:
  - src/recording-provider.ts
  - src/mock-tool-provider.ts
  - src/builders.ts
  - src/assertions.ts
---

# @method/pacta-testkit

Verification affordances for Pacta agents -- recording providers, fluent builders, and assertion helpers.

## Overview

The testkit provides everything needed to test Pacta agents without invoking real LLMs or spawning real processes. It includes:

- **RecordingProvider** -- an AgentProvider that records all interactions and replays scripted responses
- **MockToolProvider** -- a ToolProvider with scripted tool results
- **Fluent builders** -- `pactBuilder()` and `agentRequestBuilder()` for constructing test objects
- **Assertion helpers** -- verify tool call sequences, budget consumption, and output schemas

All assertions throw descriptive errors compatible with any test runner (node:test, vitest, jest).

## Install

```bash
npm install @method/pacta-testkit
```

## Usage

### RecordingProvider

Replays scripted responses and records every interaction for later inspection.

```typescript
import { RecordingProvider } from '@method/pacta-testkit';
import { createAgent } from '@method/pacta';
import type { AgentResult, TokenUsage, CostReport } from '@method/pacta';

const provider = new RecordingProvider();

// Script the response the provider will return
provider.setDefaultResult({
  output: 'Fixed the bug in parser.ts',
  sessionId: 'test-001',
  completed: true,
  stopReason: 'complete',
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
  cost: { totalUsd: 0.001, perModel: {} },
  durationMs: 500,
  turns: 1,
});

const agent = createAgent({
  pact: { mode: { type: 'oneshot' } },
  provider,
});

const result = await agent.invoke({ prompt: 'Fix the bug' });

// Inspect what happened
const recording = provider.lastRecording!;
console.log(recording.toolCalls.length);   // 0
console.log(recording.events.length);      // 0
console.log(recording.result?.output);     // 'Fixed the bug in parser.ts'
```

For multi-turn tests, queue multiple responses with `addResponse()`:

```typescript
provider.addResponse({
  events: [
    { type: 'tool_use', tool: 'Read', input: { file_path: '/src/parser.ts' }, toolUseId: 'tu-1' },
    { type: 'tool_result', tool: 'Read', output: 'file contents...', toolUseId: 'tu-1', durationMs: 10 },
    { type: 'turn_complete', turnNumber: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 } },
  ],
  result: { output: 'Done', sessionId: 's1', completed: true, stopReason: 'complete', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 }, cost: { totalUsd: 0.001, perModel: {} }, durationMs: 500, turns: 1 },
});
```

After invocation, the recording captures:

- `recording.events` -- all events in order
- `recording.turns` -- tool calls grouped by turn
- `recording.toolCalls` -- all tool calls flattened
- `recording.thinkingTraces` -- all thinking content
- `recording.result` -- the final AgentResult

### MockToolProvider

Implements `ToolProvider` with scripted results per tool name.

```typescript
import { MockToolProvider } from '@method/pacta-testkit';

const tools = new MockToolProvider();

tools
  .addTool(
    { name: 'Read', description: 'Read a file' },
    { output: 'file contents here' },
    { output: 'second file contents' },
  )
  .addTool(
    { name: 'Grep', description: 'Search files' },
    { output: '/src/parser.ts\n/src/lexer.ts' },
  );

// Each call to execute() consumes the next scripted response for that tool
const result1 = await tools.execute('Read', { file_path: '/src/parser.ts' });
const result2 = await tools.execute('Read', { file_path: '/src/lexer.ts' });
const result3 = await tools.execute('Grep', { pattern: 'TODO' });

// Inspect the call log
console.log(tools.callLog.length); // 3
console.log(tools.callLog[0].name); // 'Read'
```

### Fluent Builders

Construct `Pact` and `AgentRequest` objects with sensible defaults. Tests only specify the fields they care about.

```typescript
import { pactBuilder, agentRequestBuilder } from '@method/pacta-testkit';

const pact = pactBuilder()
  .withMode({ type: 'oneshot' })
  .withBudget({ maxTurns: 5, maxCostUsd: 0.10 })
  .withScope({ allowedTools: ['Read', 'Grep'] })
  .withReasoning({ thinkTool: true })
  .build();

const request = agentRequestBuilder()
  .withPrompt('Analyze the codebase')
  .withWorkdir('/project')
  .withSystemPrompt('You are a code reviewer.')
  .build();
```

`PactBuilder` methods: `withMode`, `withStreaming`, `withBudget`, `withOutput`, `withScope`, `withContext`, `withReasoning`, `build`

`AgentRequestBuilder` methods: `withPrompt`, `withWorkdir`, `withSystemPrompt`, `withResumeSessionId`, `withMetadata`, `build`

### Assertion Helpers

```typescript
import {
  assertToolsCalled,
  assertToolsCalledUnordered,
  assertBudgetUnder,
  assertOutputMatches,
} from '@method/pacta-testkit';

// Assert exact tool call sequence (ordered)
assertToolsCalled(recording, ['Grep', 'Read', 'Edit']);

// Assert tool calls regardless of order
assertToolsCalledUnordered(recording, ['Edit', 'Grep', 'Read']);

// Assert budget consumption stayed within limits
assertBudgetUnder(result, {
  maxTokens: 5000,
  maxCostUsd: 0.10,
  maxTurns: 10,
  maxDurationMs: 30_000,
});

// Assert output matches a schema (returns the parsed data)
const parsed = assertOutputMatches(result, {
  parse: (raw) => {
    if (typeof raw === 'string' && raw.length > 0) {
      return { success: true, data: raw };
    }
    return { success: false, errors: ['Expected non-empty string'] };
  },
});
```

## API Surface

### RecordingProvider

| Method / Property | Description |
|---|---|
| `addResponse(response)` | Queue a scripted response for the next invoke() call |
| `setDefaultResult(result)` | Set the fallback result when no scripted responses remain |
| `recordings` | All recordings (readonly array) |
| `lastRecording` | Most recent recording |
| `reset()` | Clear all recordings and scripted responses |

### MockToolProvider

| Method / Property | Description |
|---|---|
| `addTool(definition, ...responses)` | Register a tool with scripted responses |
| `callLog` | Readonly array of all calls made |
| `reset()` | Clear all tools and call history |

### Builders

| Function | Returns |
|---|---|
| `pactBuilder<T>()` | `PactBuilder<T>` with sensible defaults (oneshot mode) |
| `agentRequestBuilder()` | `AgentRequestBuilder` with default prompt "test prompt" |

### Assertions

| Function | Throws on |
|---|---|
| `assertToolsCalled(recording, expectedTools)` | Wrong tool sequence |
| `assertToolsCalledUnordered(recording, expectedTools)` | Missing or extra tools |
| `assertBudgetUnder(result, limits)` | Any budget limit exceeded |
| `assertOutputMatches(result, schema)` | Schema validation failure |

## Architecture

```
src/
  recording-provider.ts    RecordingProvider — captures events, tool calls, thinking traces
  mock-tool-provider.ts    MockToolProvider — scripted ToolResult sequences per tool name
  builders.ts              PactBuilder, AgentRequestBuilder — fluent test object construction
  assertions.ts            assertToolsCalled, assertBudgetUnder, assertOutputMatches
  conformance/             Cortex agent conformance testkit (S8 / PRD-065)
    conformance-runner.ts    runCortexAgentConformance entry point
    mock-cortex-ctx.ts       MockCortexCtx + CallRecorder
    compliance-report.ts     ComplianceReport schema + JCS-lite canonicalization + Ed25519 signer
    cortex-types.ts          Structural mirrors of CortexCtx / MethodAgentResult (sync'd to @method/agent-runtime)
    plugin.ts                ConformancePlugin interface + DEFAULT_REQUIRED_PLUGIN_IDS
    plugins/                 Built-in s1-method-agent-port + s3-service-adapters plugins
    fixtures/                Three canonical v1 fixtures
```

## Cortex Agent Conformance (`./conformance` subpath — PRD-065)

Cortex tenant apps of `category: agent` run the conformance suite from their
own CI to self-certify compliance with `MethodAgentPort` (S1) and the Cortex
service adapters (S3). The produced `ComplianceReport.json` is uploaded to
Cortex, which verifies the detached Ed25519 signature and flips
`certified: true`.

```typescript
import { runCortexAgentConformance } from '@method/pacta-testkit/conformance';
import app from '../src/agent.js';            // default export: (ctx) => unknown

const report = await runCortexAgentConformance({
  app,
  appId: 'incident-triage',
  outputPath: './compliance-report.json',
  signer: await loadSignerFromCi(),           // optional, required for prod
  keyId: process.env.METHOD_CONFORMANCE_KEY_ID,
});
if (!report.passed) throw new Error(report.summary);
```

**What runs:** every canonical fixture (`incident-triage`,
`feature-dev-commission`, `daily-report`) against a fresh `MockCortexCtx`,
followed by the two required plugins checking six S1 invariants
(C1–C6) and three S3 adapter invariants (A1–A3). Future S4/S5/S6/S7 plugins
extend the set via `opts.plugins: [...DEFAULT_PLUGINS, myPlugin]`.

**Signing recipe** — load a PEM key via 1Password and pass
`createEd25519Signer` as the signer:

```typescript
import { createEd25519Signer } from '@method/pacta-testkit/conformance';

const pem = process.env.METHOD_CONFORMANCE_SIGNING_KEY_PEM!;
const signer = createEd25519Signer(pem);
// …pass signer to runCortexAgentConformance opts
```

Peer dependency on `@method/agent-runtime` is declared **optional**; the
conformance subpath uses structural type mirrors (`cortex-types.ts`) so
non-conformance consumers of the testkit do not need to install it.

## Development

```bash
npm run build              # TypeScript build
npm test                   # Run all tests (core + conformance)
npm run test-conformance   # Run only the conformance suite
```
