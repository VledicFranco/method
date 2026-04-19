# @methodts/pacta-provider-claude-cli

Claude Code CLI subprocess provider for `@methodts/pacta`. Implements `AgentProvider` by spawning `claude` CLI processes — enabling full tool access (file read/write, bash, MCP tools) within a sandboxed session.

## Usage

```typescript
import { claudeCliProvider } from '@methodts/pacta-provider-claude-cli';

const provider = claudeCliProvider({
  cwd: '/path/to/project',
  allowedTools: ['Read', 'Write', 'Bash'],
});
```

## Features

- **Full tool access**: agent can read/write files, run bash commands, use MCP tools
- **Session isolation**: each commission spawns an independent `claude --print` subprocess
- **Simple code agent**: `SimpleCodeAgent` — pre-configured for code-focused tasks
- **CLI executor**: `CliExecutor` — low-level subprocess management with output parsing

## Components

| Component | Description |
|-----------|-------------|
| `claudeCliProvider()` | Factory — returns a configured `ClaudeCliProvider` |
| `CliExecutor` | Manages `claude` subprocess lifecycle and output streaming |
| `SimpleCodeAgent` | Pre-assembled agent for code tasks (Read, Write, Bash tools enabled) |

## When to Use

Use this provider when the agent needs full filesystem and tool access — build tasks, code generation, test execution. For API-only usage without a CLI dependency, prefer `@methodts/pacta-provider-anthropic`.
