---
title: Triggers
scope: domain
package: bridge
contents:
  - index.ts
  - types.ts
  - config.ts
  - trigger-router.ts
  - trigger-parser.ts
  - trigger-routes.ts
  - triggers.test.ts
  - debounce.ts
  - file-watch-trigger.ts
  - git-commit-trigger.ts
  - schedule-trigger.ts
  - pty-watcher-trigger.ts
  - webhook-trigger.ts
  - glob-match.ts
  - sandbox-eval.ts
  - startup-scan.ts
---

# Triggers

Event-driven trigger system (PRD 018) that automatically fires strategy executions in response to external signals. The domain provides five watcher types — file changes, git commits, cron schedules, PTY watcher observations, and inbound webhooks — each producing trigger events that flow through a central router with configurable debounce. Triggers are declared in strategy YAML files, auto-registered on bridge startup, and manageable at runtime via HTTP API including enable/disable, hot reload, and global pause/resume.

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for all trigger types and the router |
| [types.ts](types.ts) | Core type definitions — TriggerWatcher interface, TriggerEvent, TriggerRegistration, debounce config |
| [trigger-router.ts](trigger-router.ts) | Central coordinator managing watcher lifecycle, debounce, and strategy execution dispatch |
| [trigger-parser.ts](trigger-parser.ts) | Extracts trigger definitions from strategy YAML files into typed TriggerConfig objects |
| [trigger-routes.ts](trigger-routes.ts) | Fastify routes for trigger management API and dynamic webhook endpoint registration |
| [debounce.ts](debounce.ts) | Debounce engine collapsing rapid events into batched fires with trailing or leading strategies |
| [file-watch-trigger.ts](file-watch-trigger.ts) | Watches file paths via fs.watch() and emits events on create, modify, or delete |
| [git-commit-trigger.ts](git-commit-trigger.ts) | Detects new git commits via fs.watch() on .git/refs with polling fallback on Linux |
| [schedule-trigger.ts](schedule-trigger.ts) | Fires on cron schedules using a lightweight 5-field parser (minute through day-of-week, UTC) |
| [pty-watcher-trigger.ts](pty-watcher-trigger.ts) | Hooks into PTY watcher observations filtering by category and optional sandboxed condition |
| [webhook-trigger.ts](webhook-trigger.ts) | Receives external webhook payloads with HMAC-SHA256 signature validation and optional filter |
| [config.ts](config.ts) | Zod-validated configuration schema and env var loader |
| [glob-match.ts](glob-match.ts) | Lightweight glob pattern matcher supporting *, **, ?, [chars], and {a,b} braces |
| [sandbox-eval.ts](sandbox-eval.ts) | Sandboxed JavaScript expression evaluator for filter and condition expressions |
| [startup-scan.ts](startup-scan.ts) | Scans .method/strategies/*.yaml on bridge startup and registers triggers with error isolation |
