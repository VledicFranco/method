---
guide: 29
title: "Pacta: Testing with Playground"
domain: pacta
audience: [contributors, agent-operators]
summary: >-
  Test agents against virtual filesystems and scripted tools without calling real LLMs.
prereqs: [26]
touches:
  - packages/pacta-testkit/src/
  - packages/pacta-playground/src/
---

# Guide 29 — Pacta: Testing with Playground

Pacta ships two testing packages: `@methodts/pacta-testkit` for unit-level verification affordances, and `@methodts/pacta-playground` for scenario-level evaluation with simulated environments. Together they let you test agent behavior without calling real LLMs.

## @methodts/pacta-testkit

The testkit provides four tools: a recording provider, a mock tool provider, fluent builders, and assertion helpers.

### RecordingProvider

`RecordingProvider` implements `AgentProvider` and records everything. Configure it with scripted responses, then inspect the recording after invocation.

```typescript
import { RecordingProvider } from '@methodts/pacta-testkit';
import { createAgent } from '@methodts/pacta';
import type { AgentResult, TokenUsage } from '@methodts/pacta';

const provider = new RecordingProvider();

// Script the response the "LLM" will return
provider.addResponse({
  events: [
    { type: 'tool_use', tool: 'Read', input: { file_path: 'src/main.ts' }, toolUseId: 'tu_1' },
    { type: 'tool_result', tool: 'Read', output: 'file contents', toolUseId: 'tu_1', durationMs: 10 },
    { type: 'turn_complete', turnNumber: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 } },
  ],
  result: {
    output: 'The file looks correct.',
    sessionId: 'test-session',
    completed: true,
    stopReason: 'complete',
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
    cost: { totalUsd: 0.001, perModel: {} },
    durationMs: 500,
    turns: 1,
  },
});

const agent = createAgent({
  pact: { mode: { type: 'oneshot' } },
  provider,
});

const result = await agent.invoke({ prompt: 'Review main.ts' });

// Inspect what happened
const recording = provider.lastRecording!;
console.log(recording.toolCalls);       // [{ name: 'Read', input: {...}, output: 'file contents', ... }]
console.log(recording.thinkingTraces);  // []
console.log(recording.turns.length);    // 1
console.log(recording.result);          // the AgentResult
```

Key `RecordingProvider` methods:

| Method | Purpose |
|--------|---------|
| `addResponse(scripted)` | Queue a scripted response for the next `invoke()` call |
| `setDefaultResult(result)` | Fallback result when no scripted responses remain |
| `recordings` | All recordings (readonly array) |
| `lastRecording` | Most recent recording |
| `reset()` | Clear all recordings and scripted responses |

`RecordingProvider` supports all execution modes (`oneshot`, `resumable`, `persistent`) so it works with any pact configuration.

### MockToolProvider

`MockToolProvider` implements `ToolProvider` with scripted tool results:

```typescript
import { MockToolProvider } from '@methodts/pacta-testkit';

const tools = new MockToolProvider();

tools.addTool(
  { name: 'Read', description: 'Read a file' },
  { output: 'function main() { return 42; }' },  // first call
  { output: 'import { test } from "vitest";' },   // second call
);

tools.addTool(
  { name: 'Grep', description: 'Search files' },
  { output: 'src/main.ts:1:function main' },
);

// Use with the Anthropic provider (which needs a ToolProvider for tool loops)
const provider = anthropicProvider({ toolProvider: tools });

// After the test, inspect what was called
console.log(tools.callLog);
// [{ name: 'Read', input: {...}, result: { output: '...' } }, ...]
```

### Fluent Builders

`pactBuilder()` and `agentRequestBuilder()` construct test objects with sensible defaults:

```typescript
import { pactBuilder, agentRequestBuilder } from '@methodts/pacta-testkit';

const pact = pactBuilder()
  .withMode({ type: 'resumable' })
  .withBudget({ maxCostUsd: 1.0, maxTurns: 10 })
  .withScope({ allowedTools: ['Read', 'Grep'] })
  .withReasoning({ thinkTool: true })
  .build();

const request = agentRequestBuilder()
  .withPrompt('Find all TODO comments')
  .withWorkdir('/project')
  .withSystemPrompt('Be concise.')
  .build();
```

All fields have defaults — `pactBuilder().build()` returns `{ mode: { type: 'oneshot' } }`. Specify only the fields your test cares about.

### Assertion Helpers

Four assertions are provided for verifying agent behavior:

```typescript
import {
  assertToolsCalled,
  assertToolsCalledUnordered,
  assertBudgetUnder,
  assertOutputMatches,
} from '@methodts/pacta-testkit';
import type { Recording } from '@methodts/pacta-testkit';

// Assert exact tool call sequence
assertToolsCalled(recording, ['Read', 'Grep', 'Edit']);

// Assert tool calls happened (any order)
assertToolsCalledUnordered(recording, ['Grep', 'Read', 'Edit']);

// Assert the result stayed within budget
assertBudgetUnder(result, {
  maxTokens: 5000,
  maxCostUsd: 0.50,
  maxDurationMs: 10_000,
  maxTurns: 5,
});

// Assert output matches a schema
const parsed = assertOutputMatches(result, mySchema);
// Returns the parsed data if valid, throws with details if not
```

All assertions throw descriptive errors on failure, compatible with any test runner (vitest, node:test, etc.).

## @methodts/pacta-playground

The playground is a scenario-level evaluation environment. It runs agents against simulated tool providers and produces structured `EvalReport` objects.

### Fidelity Tiers

The playground supports three simulation tiers:

| Tier | Name | Simulation | Cost |
|------|------|-----------|------|
| 1 | **Stub** | All tools return canned responses | Free |
| 2 | **Script** | Tools follow input-matching rules (`given X -> return Y`) | Free |
| 3 | **Virtual** | In-memory filesystem — Read/Write/Edit/Glob/Grep operate on virtual files | Free |

The `FidelityLevel` type (`'stub' | 'script' | 'virtual'`) labels the tier.

### VirtualToolProvider (Tier 3)

An in-memory filesystem that implements `ToolProvider`. Supports Read, Write, Edit, Glob, and Grep with real semantics:

```typescript
import { VirtualToolProvider } from '@methodts/pacta-playground';

const vfs = new VirtualToolProvider({
  'src/main.ts': 'function main() {\n  return 42;\n}\n',
  'src/utils.ts': 'export function add(a: number, b: number) { return a + b; }\n',
  'package.json': '{ "name": "test-project" }\n',
});

// Simulate tool calls
const readResult = await vfs.execute('Read', { file_path: 'src/main.ts' });
console.log(readResult.output);
// "     1\tfunction main() {\n     2\t  return 42;\n     3\t}\n"

const editResult = await vfs.execute('Edit', {
  file_path: 'src/main.ts',
  old_string: 'return 42;',
  new_string: 'return 0;',
});
console.log(editResult.output);  // "File edited: src/main.ts"

// Verify the edit took effect
console.log(vfs.getFile('src/main.ts'));
// "function main() {\n  return 0;\n}\n"

const grepResult = await vfs.execute('Grep', {
  pattern: 'function',
  output_mode: 'files_with_matches',
});
console.log(grepResult.output);  // "src/main.ts\nsrc/utils.ts"
```

The virtual FS faithfully emulates Claude Code's tool behavior: Read produces `cat -n` style output with line numbers, Edit enforces uniqueness of `old_string` (unless `replace_all` is true), and Grep supports content/files_with_matches/count output modes.

### ScriptedToolProvider (Tier 2)

Rule-based tool responses for Tier 2 fidelity:

```typescript
import { ScriptedToolProvider } from '@methodts/pacta-playground';

const scripted = new ScriptedToolProvider();

// Register tools
scripted.addTool({ name: 'Read', description: 'Read a file' });
scripted.addTool({ name: 'Grep', description: 'Search files' });

// Add rules: given(toolName, inputMatcher) -> thenReturn(result)
scripted.given('Read', (input: any) => input.file_path === 'src/main.ts')
  .thenReturn({ output: 'function main() { ... }' });

scripted.given('Read', (input: any) => input.file_path === 'src/utils.ts')
  .thenReturn({ output: 'export function add() { ... }' });

// Match any input for a tool
scripted.givenAny('Grep')
  .thenReturn({ output: 'src/main.ts:1:function main' });

// Unmatched calls return an error result (not throw)
```

Rules are checked in registration order — the first matching rule wins.

### Scenario Builder

The scenario builder provides a fluent, declarative interface for defining test scenarios:

```typescript
import { scenario, filesystem, tools, prompt, toolsCalled, outputMatches, tokensBelow } from '@methodts/pacta-playground';
import { RecordingProvider, pactBuilder } from '@methodts/pacta-testkit';

const s = scenario('code-review-agent')
  .given(filesystem({
    'src/main.ts': 'function main() {\n  const x = null;\n  return x.toString();\n}\n',
  }))
  .given(tools(['Read', 'Grep']))
  .when(prompt('Review this file for bugs'))
  .then(toolsCalled(['Read', 'Grep']))
  .then(tokensBelow(5000));
```

The builder accepts givens (filesystem state, tool definitions, custom tool providers, fidelity level), a prompt (the `when`), and assertions (the `then`s).

Given helpers:

| Helper | Description |
|--------|-------------|
| `filesystem({ path: content })` | Initial virtual filesystem (Tier 3) |
| `tools(['Read', 'Grep'])` | Available tool names with stub responses (Tier 1) |
| `toolProvider(provider)` | Explicit ToolProvider instance |
| `fidelity('virtual')` | Declare the simulation tier |

Assertion helpers:

| Helper | Description |
|--------|-------------|
| `toolsCalled(['Read', 'Grep'])` | Expected tool sequence (in order) |
| `outputMatches(schema)` | Output validates against a SchemaDefinition |
| `tokensBelow(5000)` | Total tokens under limit |

### Running a Scenario

Run a scenario by passing an agent config with a `RecordingProvider`:

```typescript
import { scenario, filesystem, prompt, toolsCalled } from '@methodts/pacta-playground';
import { RecordingProvider, pactBuilder } from '@methodts/pacta-testkit';
import type { EvalReport } from '@methodts/pacta-playground';

const provider = new RecordingProvider();
provider.addResponse({
  events: [
    { type: 'tool_use', tool: 'Read', input: { file_path: 'src/main.ts' }, toolUseId: 'tu_1' },
    { type: 'tool_result', tool: 'Read', output: '...', toolUseId: 'tu_1', durationMs: 5 },
    { type: 'turn_complete', turnNumber: 1, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 } },
  ],
  result: {
    output: 'Found a null pointer bug on line 3',
    sessionId: 'test',
    completed: true,
    stopReason: 'complete',
    usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 },
    cost: { totalUsd: 0.002, perModel: {} },
    durationMs: 1000,
    turns: 1,
  },
});

const s = scenario('null-check-review')
  .given(filesystem({ 'src/main.ts': 'const x = null;\nx.toString();\n' }))
  .when(prompt('Find bugs'))
  .then(toolsCalled(['Read']));

const report: EvalReport = await s.run({
  name: 'review-agent-v1',
  pact: pactBuilder().withBudget({ maxTurns: 10 }).build(),
  provider,
});

console.log(report.behavioral.toolsCorrect);  // true
console.log(report.resources.tokens);          // 300
console.log(report.reasoning.thinkToolUsed);   // false
```

### The EvalReport

Every scenario run produces a structured evaluation report:

```typescript
interface EvalReport {
  scenario: string;                    // scenario name
  agent: string;                       // agent config name
  behavioral: {
    toolsCorrect: boolean;             // tools matched expected sequence
    sequenceCorrect: boolean;          // tool order matched
  };
  output: {
    schemaValid: boolean;              // output matched schema (if asserted)
    qualityScore?: number;             // optional quality score (future)
  };
  resources: {
    tokens: number;                    // total tokens consumed
    cost: number;                      // total cost in USD
    turns: number;                     // agentic turns
    durationMs: number;                // wall-clock time
  };
  reasoning: {
    planDetected: boolean;             // thinking traces contain planning language
    reflectionDetected: boolean;       // thinking traces contain reflection language
    thinkToolUsed: boolean;            // "think" tool was called
  };
  robustness?: {
    faultInjected: string;             // what fault was injected (future)
    recovered: boolean;                // whether the agent recovered (future)
  };
}
```

The reasoning detection is heuristic — it checks thinking traces for keywords like "plan", "step", "reflect", "mistake" etc.

### Comparative Evaluation

Run the same scenario against two agent configs to compare behavior:

```typescript
import { scenario, filesystem, prompt, toolsCalled, compareAgents } from '@methodts/pacta-playground';
import { RecordingProvider, pactBuilder } from '@methodts/pacta-testkit';
import type { ComparativeReport } from '@methodts/pacta-playground';

const s = scenario('edit-task')
  .given(filesystem({ 'src/main.ts': 'old code' }))
  .when(prompt('Fix the bug'));

const providerA = new RecordingProvider();
providerA.addResponse({ /* ... scripted response for agent A ... */ });

const providerB = new RecordingProvider();
providerB.addResponse({ /* ... scripted response for agent B ... */ });

const report: ComparativeReport = await compareAgents(
  s,
  { name: 'agent-v1', pact: pactBuilder().build(), provider: providerA },
  { name: 'agent-v2', pact: pactBuilder().withReasoning({ thinkTool: true }).build(), provider: providerB },
);

console.log(report.diff.tokenDelta);        // positive if B used more tokens
console.log(report.diff.costDelta);          // positive if B cost more
console.log(report.diff.bothCorrect);        // true if both got tools right
console.log(report.diff.toolSequenceSame);   // true if both used same tool sequence
```

The `ComparativeReport` includes both individual `EvalReport` objects and a `diff` summary:

```typescript
interface ComparativeReport {
  scenario: string;
  agents: [string, string];
  reports: [EvalReport, EvalReport];
  diff: {
    toolSequenceSame: boolean;
    toolCountDelta: number;
    tokenDelta: number;
    costDelta: number;
    turnsDelta: number;
    durationDelta: number;
    bothCorrect: boolean;
    bothSchemaValid: boolean;
  };
}
```

## Putting It All Together

A complete test file using both testkit and playground:

```typescript
import { describe, it, expect } from 'vitest';
import { createAgent } from '@methodts/pacta';
import { RecordingProvider, pactBuilder, assertToolsCalled, assertBudgetUnder } from '@methodts/pacta-testkit';
import { scenario, filesystem, prompt, toolsCalled } from '@methodts/pacta-playground';

describe('my agent', () => {
  it('calls Read then Edit for a fix task', async () => {
    const provider = new RecordingProvider();
    provider.addResponse({
      events: [
        { type: 'tool_use', tool: 'Read', input: { file_path: 'src/bug.ts' }, toolUseId: 'tu_1' },
        { type: 'tool_result', tool: 'Read', output: 'buggy code', toolUseId: 'tu_1', durationMs: 5 },
        { type: 'tool_use', tool: 'Edit', input: { file_path: 'src/bug.ts', old_string: 'bug', new_string: 'fix' }, toolUseId: 'tu_2' },
        { type: 'tool_result', tool: 'Edit', output: 'File edited', toolUseId: 'tu_2', durationMs: 5 },
        { type: 'turn_complete', turnNumber: 1, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 } },
      ],
      result: {
        output: 'Fixed the bug',
        sessionId: 'test',
        completed: true,
        stopReason: 'complete',
        usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 },
        cost: { totalUsd: 0.002, perModel: {} },
        durationMs: 500,
        turns: 1,
      },
    });

    const agent = createAgent({
      pact: pactBuilder().withBudget({ maxTurns: 5 }).build(),
      provider,
    });

    const result = await agent.invoke({ prompt: 'Fix the bug in src/bug.ts' });

    expect(result.completed).toBe(true);
    assertToolsCalled(provider.lastRecording!, ['Read', 'Edit']);
    assertBudgetUnder(result, { maxTokens: 1000, maxTurns: 5 });
  });

  it('produces a passing eval report', async () => {
    const provider = new RecordingProvider();
    provider.addResponse({ /* ... */ });

    const s = scenario('fix-bug')
      .given(filesystem({ 'src/bug.ts': 'buggy code' }))
      .when(prompt('Fix the bug'))
      .then(toolsCalled(['Read', 'Edit']));

    const report = await s.run({
      name: 'fix-agent',
      pact: pactBuilder().build(),
      provider,
    });

    expect(report.behavioral.toolsCorrect).toBe(true);
  });
});
```

## Next Steps

- **[Guide 26 — Pacta: Getting Started](./26-pacta-getting-started.md)** — Introduction to the SDK.
- **[Guide 27 — Pacta: Assembling Agents](./27-pacta-assembling-agents.md)** — Full composition API.
- **[Guide 28 — Pacta: Implementing Providers](./28-pacta-providers.md)** — Building custom providers.
