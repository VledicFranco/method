# Shared — Validation

Cross-domain validation utilities. Enforces isolation invariants — prevents agents in one project session from accessing files or resources belonging to a different project.

## Components

| Component | Description |
|-----------|-------------|
| `IsolationValidator` | Checks that a file path is within the allowed project root; rejects traversal attempts |
| `ProjectAccessValidator` | Validates that a session ID is authorized to access a given `ProjectId` |

## Isolation Enforcement

`IsolationValidator` is applied at the PTY session boundary: before any shell command is executed or file is read, the requested path is resolved against the session's registered project root. Paths that escape the root (via `../`, symlinks resolving outside, or absolute paths to foreign projects) are rejected with an `ISOLATION_VIOLATION` error.

This is the structural guard that prevents multi-project leakage — a critical security boundary when multiple projects share the same bridge process.
