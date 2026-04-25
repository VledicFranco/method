# method

Runtime that makes formal methodologies executable by LLM agents.

## Packages

Published under the [`@methodts`](https://www.npmjs.com/org/methodts) npm scope:

| Package | Layer | Purpose |
|---|---|---|
| [`@methodts/types`](packages/types) | L1 | Shared type primitives |
| [`@methodts/pacta`](packages/pacta) | L3 | Modular agent SDK — pacts, providers, middleware, composition engine |
| [`@methodts/pacta-provider-anthropic`](packages/pacta-provider-anthropic) | L3 | Pacta provider — Anthropic SDK |
| [`@methodts/pacta-provider-claude-cli`](packages/pacta-provider-claude-cli) | L3 | Pacta provider — local Claude CLI |
| [`@methodts/pacta-provider-cortex`](packages/pacta-provider-cortex) | L3 | Pacta provider — Cortex `ctx.llm` adapter |
| [`@methodts/pacta-provider-ollama`](packages/pacta-provider-ollama) | L3 | Pacta provider — Ollama |
| [`@methodts/pacta-testkit`](packages/pacta-testkit) | L2 | Conformance testkit for Cortex agents |
| [`@methodts/methodts`](packages/methodts) | L2 | Typed methodology SDK — predicates, steps, methods, gates |
| [`@methodts/cluster`](packages/cluster) | L3 | Cluster protocol — membership, routing, federation |
| [`@methodts/runtime`](packages/runtime) | L3 | Cortex-agnostic runtime — strategy executor, ports |
| [`@methodts/agent-runtime`](packages/agent-runtime) | L3 | Tenant-app public API — `createMethodAgent` factory |
| [`@methodts/mcp`](packages/mcp) | L3 | MCP protocol adapter |
| [`@fractal-co-design/fca-index`](packages/fca-index) | L3 | Fractal Component Architecture indexer (migrated from `@methodts/fca-index@0.4.x` — see [packages/fca-index/MOVED.md](packages/fca-index/MOVED.md)) |

The `bridge`, `method-ctl`, `pacta-playground`, and `smoke-test` packages are internal to this repo and are not published.

> **fca-index migration (2026-04-25):** `@methodts/fca-index` has moved to the [Fractal Co-Design](https://github.com/VledicFranco/fractal-co-design) project as `@fractal-co-design/fca-index@1.0.0`. Method-2's local `packages/fca-index/` will remain in place for the deprecation window; downstream consumers (`mcp`, `runtime`, `bridge`) have been re-pointed at the new package. See [packages/fca-index/MOVED.md](packages/fca-index/MOVED.md).

## Releasing

```bash
npm run release:patch    # 0.1.0 → 0.1.1
npm run release:minor    # 0.1.0 → 0.2.0
npm run release:major    # 0.1.0 → 1.0.0
```

The release script bumps every publishable package to the same version, updates `CHANGELOG.md`, commits, tags, pushes, and creates a GitHub release. The `Release` workflow then publishes to npm with provenance.

See [`scripts/release.mjs`](scripts/release.mjs) for the full flow.

## Architecture

This project follows [Fractal Component Architecture](docs/fractal-component-architecture/). See [`CLAUDE.md`](CLAUDE.md) for the layer stack and contributor rules.

## License

[Apache License 2.0](LICENSE) — chosen for its explicit patent grant. See also [NOTICE](NOTICE) for attribution.

Each source file carries an `SPDX-License-Identifier: Apache-2.0` header.
