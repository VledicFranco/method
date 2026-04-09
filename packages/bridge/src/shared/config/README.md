# Shared — Config Reload

Hot-reload infrastructure for bridge configuration. Allows bridge domains to pick up `.env` or config file changes without restarting the process.

## Components

| Component | Description |
|-----------|-------------|
| `loadConfig` | Initial config load — reads env + config files, returns validated object |
| `validateConfig` | Zod-based config validator; throws on schema violations |
| `reloadConfig` | Diff-aware reload — applies changes incrementally, emits delta events |
| `FileWatcher` | `node:fs/promises` watcher abstraction — debounces rapid file changes |

## Usage Pattern

The composition root (`server-entry.ts`) creates a `FileWatcher` on the config file(s). On change events, it calls `reloadConfig` and distributes the updated config to domains via their `ConfigReloadRequest` handlers.

Domains that need live config implement a `ConfigReloadRequest` handler and register it with the shared config module at startup. This avoids polling and keeps domain logic decoupled from the filesystem watcher lifecycle.
