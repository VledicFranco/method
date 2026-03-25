---
title: "@method/pacta-provider-claude-cli"
scope: package
layer: L3
contents:
  - src/claude-cli-provider.ts
  - src/cli-executor.ts
  - src/simple-code-agent.ts
---

# @method/pacta-provider-claude-cli

AgentProvider implementation for Claude Code CLI -- wraps `claude --print` and `claude --resume`.

## Overview

This package provides a Pacta `AgentProvider` that invokes the Claude CLI as a child process. It supports two execution modes:

- **Oneshot** -- `claude --print` for single prompt-response invocations
- **Resumable** -- `claude --resume <sessionId>` to continue a prior session

The provider implements both `AgentProvider` and `Resumable` interfaces. It does not support streaming (the CLI operates in batch mode).

Also includes `simpleCodeAgent` -- a ready-to-use agent that combines `claudeCliProvider` with a minimal code-focused pact.

## Install

```bash
npm install @method/pacta-provider-claude-cli
```

Requires the `claude` CLI to be installed and available on `PATH`.

## Layer Position

```
L4  @method/bridge                      Uses providers to deploy agents
L3  @method/pacta-provider-claude-cli   This package
    @method/pacta                       Core SDK (peer dependency)
```

## Usage

### Basic Provider

```typescript
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';
import { createAgent } from '@method/pacta';

const provider = claudeCliProvider();

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    scope: { allowedTools: ['Read', 'Grep', 'Glob'] },
  },
  provider,
});

const result = await agent.invoke({
  prompt: 'List all exported functions in src/index.ts',
  workdir: '/my-project',
});

console.log(result.output);
```

### Provider Options

```typescript
const provider = claudeCliProvider({
  binary: 'claude',        // CLI binary name (default: 'claude')
  model: 'claude-sonnet-4-6',  // Default model override
  timeoutMs: 300_000,      // Execution timeout in ms (default: 5 min)
});
```

### Resumable Sessions

The provider implements `Resumable`, so it can resume prior sessions:

```typescript
const provider = claudeCliProvider();

const agent = createAgent({
  pact: { mode: { type: 'resumable' } },
  provider,
});

// First invocation
const result1 = await agent.invoke({ prompt: 'Read the README' });
const sessionId = result1.sessionId;

// Resume with the same session
const result2 = await provider.resume(sessionId, agent.pact, {
  prompt: 'Now summarize what you read',
});
```

### simpleCodeAgent

A one-liner for common coding tasks:

```typescript
import { simpleCodeAgent } from '@method/pacta-provider-claude-cli';

const agent = simpleCodeAgent();

const result = await agent.invoke({
  prompt: 'Add error handling to the database connection',
  workdir: '/my-project',
});
```

Default pact: oneshot mode, tools limited to Read/Grep/Glob/Edit/Write.

### CLI Executor (Advanced)

For custom provider implementations or direct CLI invocation:

```typescript
import { executeCli, buildCliArgs } from '@method/pacta-provider-claude-cli';

const args = buildCliArgs({
  prompt: 'Explain this code',
  print: true,
  model: 'claude-sonnet-4-6',
  allowedTools: ['Read', 'Grep'],
  cwd: '/project',
});

const result = await executeCli(
  { prompt: 'Explain this code', print: true, cwd: '/project' },
  { binary: 'claude', timeoutMs: 60_000 },
);

console.log(result.exitCode);  // 0
console.log(result.stdout);    // CLI output
```

## Capabilities

```typescript
provider.capabilities();
// {
//   modes: ['oneshot', 'resumable'],
//   streaming: false,
//   resumable: true,
//   budgetEnforcement: 'none',
//   outputValidation: 'client',
//   toolModel: 'builtin',
// }
```

- **Modes**: oneshot and resumable (the CLI manages sessions via `--resume`)
- **Streaming**: not supported (batch process)
- **Budget enforcement**: none (client-side via `budgetEnforcer` middleware)
- **Output validation**: client-side (CLI returns plain text)
- **Tool model**: builtin (the CLI has its own tool implementation)

## API Surface

### Provider Factory

`claudeCliProvider(options?)` -- creates `ClaudeCliProvider` (AgentProvider & Resumable)

`ClaudeCliProviderOptions`: binary, model, timeoutMs, executorOptions

### Pre-Assembled Agent

`simpleCodeAgent(options?)` -- creates `Agent<string>` with oneshot pact + Read/Grep/Glob/Edit/Write

### CLI Executor

`executeCli(args, options?)` -- spawns the CLI process, returns `CliResult` (exitCode, stdout, stderr)

`buildCliArgs(args)` -- converts `CliArgs` to a string array for spawning

`CliArgs`: prompt, print, resumeSessionId, cwd, allowedTools, model, systemPrompt, maxTurns

`ExecutorOptions`: spawnFn (override for testing), binary, timeoutMs

### Error Types

`CliTimeoutError` -- CLI process exceeded timeout

`CliSpawnError` -- failed to spawn the CLI binary

`CliExecutionError` -- CLI exited with non-zero exit code

## Architecture

```
src/
  claude-cli-provider.ts   claudeCliProvider() factory — AgentProvider & Resumable
  cli-executor.ts          executeCli(), buildCliArgs() — process spawning + capture
  simple-code-agent.ts     simpleCodeAgent() — pre-assembled oneshot code agent
```

## Development

```bash
npm run build            # TypeScript build
npm test                 # Run all tests
```
