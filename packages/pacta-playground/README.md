---
title: "@method/pacta-playground"
scope: package
layer: L3
contents:
  - src/types.ts
  - src/virtual-tool-provider.ts
  - src/scripted-tool-provider.ts
  - src/scenario.ts
  - src/comparative-runner.ts
---

# @method/pacta-playground

Simulated agent evaluation environment -- virtual tools, scenario runner, and comparative analysis.

## Overview

The playground provides a controlled evaluation environment for Pacta agents at three fidelity tiers:

| Tier | Level | Provider | Description |
|------|-------|----------|-------------|
| 1 | Stub | ScriptedToolProvider | Tools return fixed strings. Fastest. |
| 2 | Script | ScriptedToolProvider | Tools match inputs and return conditional results. |
| 3 | Virtual | VirtualToolProvider | Full in-memory filesystem with Read/Write/Edit/Glob/Grep. |

No real filesystem access. No real LLM calls. Every tool interaction is deterministic and inspectable.

The package also includes a fluent scenario builder for declaring evaluation scenarios and a comparative runner for diffing two agent configurations side-by-side.

## Install

```bash
npm install @method/pacta-playground
```

## Layer Position

```
L4  @method/bridge                Uses playground for testing
L3  @method/pacta-playground      This package
    @method/pacta                 Core SDK (peer dependency)
    @method/pacta-testkit         Recording + assertions (peer dependency)
```

## Usage

### VirtualToolProvider (Tier 3)

A `ToolProvider` backed by an in-memory `Map<string, string>`. Implements Read, Write, Edit, Glob, and Grep operations with no host side effects.

```typescript
import { VirtualToolProvider } from '@method/pacta-playground';

const vfs = new VirtualToolProvider({
  '/src/index.ts': 'export function greet() { return "hello"; }',
  '/src/utils.ts': 'export const PI = 3.14;',
  '/README.md': '# My Project',
});

// Read a file (returns cat -n style output)
const readResult = await vfs.execute('Read', { file_path: '/src/index.ts' });

// Write a new file
await vfs.execute('Write', { file_path: '/src/new.ts', content: 'export default 42;' });

// Edit an existing file
await vfs.execute('Edit', {
  file_path: '/src/index.ts',
  old_string: '"hello"',
  new_string: '"world"',
});

// Glob for files
const globResult = await vfs.execute('Glob', { pattern: '**/*.ts' });

// Grep for content
const grepResult = await vfs.execute('Grep', {
  pattern: 'export',
  output_mode: 'files_with_matches',
});

// Inspect virtual filesystem state
console.log(vfs.getFile('/src/index.ts'));  // Updated content
console.log(vfs.files.size);                // 4

// Inspect call log
console.log(vfs.callLog.length);            // 5
```

The VirtualToolProvider supports:
- **Read**: file_path, offset, limit (cat -n style line numbers)
- **Write**: file_path, content
- **Edit**: file_path, old_string, new_string, replace_all (uniqueness check)
- **Glob**: pattern, path (supports `**`, `*`, `?`, `{a,b}`)
- **Grep**: pattern (regex), path, glob, output_mode (content/files_with_matches/count)

### ScriptedToolProvider (Tier 1-2)

A `ToolProvider` with rule-based responses. Define what each tool returns for given inputs.

```typescript
import { ScriptedToolProvider } from '@method/pacta-playground';

const scripted = new ScriptedToolProvider();

// Register tools
scripted.addTool({ name: 'Read', description: 'Read a file' });
scripted.addTool({ name: 'Grep', description: 'Search files' });

// Tier 1 (stub): match any input
scripted.givenAny('Read').thenReturn({ output: 'file contents' });

// Tier 2 (script): conditional matching
scripted
  .given('Read', (input: any) => input.file_path === '/src/index.ts')
  .thenReturn({ output: 'export function main() {}' });

scripted
  .given('Read', (input: any) => input.file_path === '/src/utils.ts')
  .thenReturn({ output: 'export const VERSION = "1.0";' });

scripted
  .given('Grep', (input: any) => input.pattern === 'export')
  .thenReturn({ output: '/src/index.ts\n/src/utils.ts' });

// Rules are evaluated in order -- first matching rule wins
const result = await scripted.execute('Read', { file_path: '/src/index.ts' });
console.log(result.output); // 'export function main() {}'

// Unmatched calls return an error result (not an exception)
const unknown = await scripted.execute('Read', { file_path: '/nonexistent' });
console.log(unknown.isError); // true
```

### Scenario Builder

Declarative scenario definition using a fluent Given/When/Then API:

```typescript
import {
  scenario,
  filesystem,
  tools,
  prompt,
  toolsCalled,
  outputMatches,
  tokensBelow,
} from '@method/pacta-playground';
import { RecordingProvider } from '@method/pacta-testkit';

const s = scenario('find-and-fix-bug')
  .given(filesystem({
    '/src/parser.ts': 'function parse(input) { return input.split(""); }',
    '/src/parser.test.ts': 'test("parse", () => { expect(parse("a,b")).toEqual(["a","b"]); });',
  }))
  .when(prompt('Fix the bug in parser.ts'))
  .then(toolsCalled(['Read', 'Edit']))
  .then(tokensBelow(5000));

// Run against an agent configuration
const provider = new RecordingProvider();
provider.setDefaultResult({
  output: 'Fixed',
  sessionId: 's1',
  completed: true,
  stopReason: 'complete',
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
  cost: { totalUsd: 0.001, perModel: {} },
  durationMs: 200,
  turns: 1,
});

const report = await s.run({
  name: 'code-agent-v1',
  pact: { mode: { type: 'oneshot' } },
  provider,
});

console.log(report.behavioral.toolsCorrect);  // true/false
console.log(report.output.schemaValid);        // true/false
console.log(report.resources.tokens);          // 150
console.log(report.reasoning.thinkToolUsed);   // true/false
```

Given helpers:
- `filesystem(files)` -- virtual filesystem (uses VirtualToolProvider)
- `tools(names)` -- stub tools by name (uses ScriptedToolProvider)
- `toolProvider(provider)` -- explicit ToolProvider instance
- `fidelity(level)` -- set fidelity tier ('stub', 'script', 'virtual')

When helper:
- `prompt(text, systemPrompt?)` -- the agent prompt

Then helpers (assertions):
- `toolsCalled(names)` -- expected tool call sequence
- `outputMatches(schema)` -- output matches a SchemaDefinition
- `tokensBelow(max)` -- total tokens under limit

### Comparative Runner

Run the same scenario against two agent configurations and diff the results:

```typescript
import { scenario, filesystem, prompt, toolsCalled, compareAgents } from '@method/pacta-playground';
import { RecordingProvider } from '@method/pacta-testkit';

const s = scenario('refactor-task')
  .given(filesystem({ '/src/app.ts': 'const x = 1;' }))
  .when(prompt('Refactor this code'))
  .then(toolsCalled(['Read', 'Edit']));

const providerA = new RecordingProvider();
providerA.setDefaultResult(/* ... */);

const providerB = new RecordingProvider();
providerB.setDefaultResult(/* ... */);

const comparative = await compareAgents(
  s,
  { name: 'agent-v1', pact: { mode: { type: 'oneshot' } }, provider: providerA },
  { name: 'agent-v2', pact: { mode: { type: 'oneshot' } }, provider: providerB },
);

console.log(comparative.diff.bothCorrect);      // Did both agents get the right tools?
console.log(comparative.diff.tokenDelta);        // Token difference (B - A)
console.log(comparative.diff.costDelta);         // Cost difference (B - A)
console.log(comparative.diff.toolSequenceSame);  // Same behavioral pattern?
```

The `ComparativeReport` includes:
- `agents` -- names of both agents
- `reports` -- full `EvalReport` for each agent
- `diff.toolSequenceSame` -- whether both agents used the same tool sequence
- `diff.tokenDelta`, `costDelta`, `turnsDelta`, `durationDelta` -- resource deltas (B minus A)
- `diff.bothCorrect`, `bothSchemaValid` -- correctness checks

## EvalReport

Every scenario run produces an `EvalReport`:

```typescript
interface EvalReport {
  scenario: string;
  agent: string;
  behavioral: { toolsCorrect: boolean; sequenceCorrect: boolean };
  output: { schemaValid: boolean; qualityScore?: number };
  resources: { tokens: number; cost: number; turns: number; durationMs: number };
  reasoning: { planDetected: boolean; reflectionDetected: boolean; thinkToolUsed: boolean };
  robustness?: { faultInjected: string; recovered: boolean };
}
```

## API Surface

### Tool Providers

`VirtualToolProvider` -- in-memory filesystem with Read/Write/Edit/Glob/Grep

`ScriptedToolProvider` -- rule-based responses with `given(name, matcher).thenReturn(result)` and `givenAny(name).thenReturn(result)`

### Scenario

`scenario(name)` -- creates a `ScenarioBuilder`

`ScenarioBuilder`: `.given()`, `.when()`, `.then()`, `.run(agentConfig)`, `.name`, `.assertions`, `.promptText`, `.resolveToolProvider()`, `.buildRequest()`

### Comparative Runner

`compareAgents(scenario, agentA, agentB)` -- returns `ComparativeReport`

### Types

`FidelityLevel` -- `'stub' | 'script' | 'virtual'`

`EvalReport` -- behavioral, output, resources, reasoning, robustness

`ComparativeReport` -- scenario, agents, reports, diff

`ScenarioAssertion` -- tools_called, output_matches, tokens_below

## Architecture

```
src/
  types.ts                   FidelityLevel, EvalReport, ComparativeReport, ScenarioAssertion
  virtual-tool-provider.ts   VirtualToolProvider — in-memory FS (Read/Write/Edit/Glob/Grep)
  scripted-tool-provider.ts  ScriptedToolProvider — rule-based given/then responses
  scenario.ts                ScenarioBuilder — fluent Given/When/Then + runner
  comparative-runner.ts      compareAgents() — run same scenario against two configs, diff
```

## Development

```bash
npm run build            # TypeScript build
npm test                 # Run all tests
```
