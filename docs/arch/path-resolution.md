# Path Resolution

## Decision

Core functions receive explicit paths (`registryPath`, `theoryPath`) as parameters. They have zero knowledge of the monorepo layout.

The MCP layer resolves paths once at startup:

```typescript
const ROOT = process.env.METHOD_ROOT ?? process.cwd();
const REGISTRY = resolve(ROOT, 'registry');
const THEORY = resolve(ROOT, 'theory');
```

## Rationale

- Core stays testable — point it at a fixture directory in tests
- Survives monorepo restructuring without touching core
- `process.cwd()` matches the actual launch path defined in `.mcp.json` (`node packages/mcp/dist/index.js` from repo root)
- `METHOD_ROOT` env var covers non-standard invocation without adding complexity

## Trade-off

`process.cwd()` is fragile if someone runs the server from a different directory. `import.meta.url` with relative resolution would be deterministic but couples to monorepo structure. The env var override mitigates the fragility without adding the coupling.
