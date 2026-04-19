# methodology/ — Methodology Session Domain

Persists active methodology state across bridge restarts. Tracks which methodology and method step an agent is currently executing, so sessions can resume after interruption.

## Purpose

When an agent is mid-method (e.g., on step 3 of M2-IMPL), that state must survive bridge restarts and can be queried by the MCP server's `methodology_status` tool. This domain provides the persistence layer — it does not execute methodology logic (that lives in `@methodts/methodts`).

## Responsibilities

- Store and retrieve active `MethodologySession` records (active method, current step, step history)
- Provide the `methodology_status` MCP endpoint with current session state
- Handle session lifecycle: start, advance step, complete, abandon

## Port Dependency

Reads/writes via `MethodologySource` port (defined in `bridge/src/ports/`). Production implementation uses `StdlibSource` which wraps the `@methodts/methodts` stdlib catalog for step schema validation.
