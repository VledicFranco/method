# @method/bridge — Bridge Application

L4 application. HTTP server that wires all bridge domains together and exposes them to the MCP adapter and external clients. Owns the process — responsible for startup, port binding, graceful shutdown, and domain composition.

## Purpose

The bridge runs as a persistent background process alongside Claude agents. It manages:
- PTY-based Claude Code sub-agent sessions (spawn, stream, interrupt, kill)
- Multi-project discovery and event persistence
- Strategy pipeline execution (gate-driven, retro-generating)
- Cost governance and token usage tracking
- Cluster coordination and peer federation
- Cognitive experiment lab

## Architecture

```
src/
  server-entry.ts       — Composition root: wires ports, registers domain routes
  ports/                — Cross-domain port interfaces (filesystem, YAML, event bus, session pool)
  domains/
    sessions/           — PTY session lifecycle, channels, scope enforcement
    methodology/        — Methodology session persistence (active method + step state)
    registry/           — Method registry management, resource copying
    projects/           — Multi-project discovery, event persistence
    strategies/         — Strategy pipeline execution, gates, retros
    tokens/             — LLM usage tracking, subscription polling
    triggers/           — Event trigger system (file, git, webhook, schedule)
    genesis/            — Multi-project agent orchestration + ambient UI
    experiments/        — Cognitive experiment lab (programmatic agent experimentation)
    cluster/            — Cluster coordination, peer discovery, federation sink
    cost-governor/      — Rate limiting, cost estimation, budget enforcement
    build/              — Build orchestrator domain (PRD 047)
  shared/               — Cross-domain utilities (config reload, validation, websocket, event bus)
```

## Key Ports (src/ports/)

- `FileSystemProvider` — filesystem abstraction (nodefs or in-memory)
- `YamlLoader` — YAML parsing (js-yaml backed)
- `MethodologySource` — methodology step lookup (StdlibSource or InMemorySource for tests)
- `EventBus` / `EventSink` — universal event backbone (PRD 026)
- `SessionPool` — PTY session lifecycle management
- `CostOracle` / `BridgeRateGovernor` — cost estimation and rate control

## Running

```bash
npm run bridge           # Start on port 3456
npm run bridge:dev       # Dev mode (tsx, no build step)
npm run bridge:test      # Test instance on port 3457 (isolated state)
npm run bridge:stop      # Stop + cleanup orphaned processes
```

Named instances: `npm run bridge -- --instance <name>` reads `.method/instances/<name>.env`
