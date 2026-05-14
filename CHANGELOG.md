# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `@methodts/runtime`: `@fractal-co-design/fca-index` moved from `dependencies` → `peerDependencies` with `peerDependenciesMeta.optional = true`. Consumers that instantiate `ContextLoadExecutorImpl` from `@methodts/runtime/strategy` must install fca-index themselves; consumers that only use `@methodts/runtime/{ports,sessions,event-bus,scheduling,…}` (e.g. `@methodts/agent-runtime`'s active code path) no longer transitively pull fca-index into their lockfile. Removes the better-sqlite3 native-build burden from every downstream tenant app that doesn't use context-load.
- `@methodts/runtime`: `ContextLoadExecutorImpl` now duck-types the `ContextQueryError` runtime check (matches by `name === 'ContextQueryError'` + `code: string` shape) instead of `instanceof ContextQueryError`. Combined with the type-only import above, the module loads cleanly even when fca-index isn't installed. Behavioural contract unchanged — fca-index's `ContextQueryError` has carried the same frozen `name` + `code` shape since 1.0.0.

## [0.3.0] - 2026-04-19

## [0.2.0] - 2026-04-19

## [0.1.0] - 2026-04-18

Initial public release. All packages published under the `@methodts` npm scope.
