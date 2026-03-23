---
title: The Levels
scope: section
---

# The Levels

The component pattern manifests at six levels. Each level has its own concrete artifacts for all eight parts, but the structural roles are identical.

| Level | Unit | Scale |
|-------|------|-------|
| **L0** | Function | A pure computation |
| **L1** | Module | A file grouping related functions |
| **L2** | Domain | A directory grouping related modules |
| **L3** | Package | A versioned library with its own dependencies |
| **L4** | Service | A deployed application exposing a network API |
| **L5** | System | An organization or platform composing services |

### How each part manifests

**Interface** — the contract consumers depend on:

| Level | Interface artifact | Enforcement |
|-------|-------------------|-------------|
| L0 Function | Type signature: `(input: A) => B` | Compiler |
| L1 Module | Exported symbols (`export function`, `export type`) | Module system |
| L2 Domain | `index.ts` re-exports + `README.md` | Directory convention |
| L3 Package | `package.json` + public `index.ts` | Package manager + semver |
| L4 Service | HTTP endpoints, OpenAPI spec, protobuf definitions | Protocol + API versioning |
| L5 System | Public SDK, developer portal | Legal contracts, SLAs |

**Boundary** — what the component cannot see through:

| Level | Boundary mechanism | What it hides |
|-------|-------------------|---------------|
| L0 Function | Lexical scope, purity | Global state, I/O, other functions' internals |
| L1 Module | Module scope, unexported symbols | Internal helpers, implementation details |
| L2 Domain | Directory boundary, private modules | Other domains' internals within the same package |
| L3 Package | Package boundary, dependency DAG | Other packages' source code |
| L4 Service | Network boundary, protocol | Other services' memory, state, database |
| L5 System | Organizational boundary | Other organizations' infrastructure |

**Port** — where dependencies are injected:

| Level | Port mechanism | Example |
|-------|--------------|---------|
| L0 Function | Function parameter, generic type parameter | `<R>(deps: R) => Effect<A, E, R>` |
| L1 Module | Constructor injection, factory parameter | `createTracker(config: TrackerConfig)` |
| L2 Domain | Provider interface + implementations directory | `interface RegistryReader { ... }` |
| L3 Package | Provider interface exported, implementation in consumer | `AgentProvider` defined in methodts, implemented in bridge |
| L4 Service | HTTP client, SDK, environment variable | `BRIDGE_URL=http://localhost:3456` |
| L5 System | API gateway, webhook registration, OAuth | Third-party API keys, webhook endpoints |

**Domain** — what the component is about:

| Level | Domain artifact | What "belongs together" means |
|-------|----------------|------------------------------|
| L0 Function | Algebraic data types, input/output types | Types that describe the same computation |
| L1 Module | Related functions operating on shared types | Functions that transform the same data |
| L2 Domain | Sub-modules, subdirectories | Modules that describe the same concept |
| L3 Package | Domain directories (`strategy/`, `triggers/`) | Directories that describe the same part of the world |
| L4 Service | Composed packages | Libraries that serve the same business capability |
| L5 System | Composed services | Services that serve the same user or workflow |

**Architecture** — how the component self-organizes its domain:

| Level | Architecture artifact | What it determines |
|-------|---------------------|-------------------|
| L0 Function | Function body, control flow, local bindings | How the computation proceeds |
| L1 Module | Function ordering, private helpers, internal state | How the module's functions relate to each other |
| L2 Domain | Sub-module structure, internal dependency order | How modules compose within the domain |
| L3 Package | Domain directories, service layers, route files | How domains compose within the package |
| L4 Service | Package composition, startup wiring, middleware stack | How packages compose into the running process |
| L5 System | Service topology, deployment architecture, data flow | How services compose into the running platform |

**Verification** — how the component is proven correct:

| Level | Verification mechanism | Example |
|-------|----------------------|---------|
| L0 Function | Call with test inputs, assert outputs | `assert.equal(formatTokens(1500), '1.5k')` |
| L1 Module | Import and call with mock dependencies | `createTracker({ sessionsDir: tmpDir })` |
| L2 Domain | Provider interface with test double | `RecordingProvider` captures all calls |
| L3 Package | Testkit: builders, assertions, harnesses | `@method/testkit` |
| L4 Service | Stub server, contract test, integration environment | Mock bridge HTTP server |
| L5 System | Staging environment, sandbox API | Pre-production deployment |

**Observability** — what the component is doing and has done:

| Level | Observability artifact | What it reveals |
|-------|----------------------|-----------------|
| L0 Function | Effect trace / span, return metadata | What the function computed, duration, what it called |
| L1 Module | Structured log emissions, counter/gauge metrics | What operations the module performed, rates, error counts |
| L2 Domain | Domain event bus, audit trail, state transition log | What happened in the domain's lifecycle, decisions made |
| L3 Package | Exported event stream, channel system, retrospectives | What the package did over time, patterns, anomalies |
| L4 Service | HTTP access logs, health endpoints, dashboards, distributed traces | What the service is doing now, request patterns, error rates |
| L5 System | Cross-service traces, SLO dashboards, incident timelines | How services interact, latency distribution, cascade failures |

**Documentation** — co-located explanation:

| Level | Documentation artifact | Where it lives |
|-------|----------------------|----------------|
| L0 Function | JSDoc comment + type signature | Above the function definition |
| L1 Module | Module-level comment, exported type descriptions | Top of the file |
| L2 Domain | `README.md` in the domain directory | `source/strategy/README.md` |
| L3 Package | `documentation/` directory with guides and decisions | `packages/bridge/documentation/` |
| L4 Service | API documentation, deployment guide | Service repository root |
| L5 System | Developer portal, architecture diagrams | Organization-level documentation site |

### The recursion

At each level, a component's **architecture** is composed of components from the level below:

```
L5 System architecture      = composed L4 Services
L4 Service architecture     = composed L3 Packages
L3 Package architecture     = composed L2 Domains
L2 Domain architecture      = composed L1 Modules
L1 Module architecture      = composed L0 Functions
L0 Function architecture    = composed expressions and types
```

And at each level, a component's **interface** is consumed by a component at the level above:

```
L0 Function interface    → consumed by L1 Module (imports the function)
L1 Module interface      → consumed by L2 Domain (re-exports via index.ts)
L2 Domain interface      → consumed by L3 Package (exposes via public API)
L3 Package interface     → consumed by L4 Service (wires into the application)
L4 Service interface     → consumed by L5 System (integrates via protocol)
```

This is why the same disciplines apply at every level. A function that changes its type signature breaks its module. A module that changes its exports breaks its domain. A package that changes its public API breaks its service. A function that emits no traces is as invisible as a service with no health endpoint. The scale changes. The structure doesn't.

### Promotion and demotion

When a component outgrows its level, promote it:

| Signal | Promotion |
|--------|-----------|
| A function grows complex enough to need its own types, tests, and documentation | Extract to a module (L0 → L1) |
| A module grows enough related functions that it needs subdirectories | Extract to a domain directory (L1 → L2) |
| A domain grows enough that it could have independent consumers and versioning | Extract to a package (L2 → L3) |
| A package grows enough that it needs its own deployment and scaling | Extract to a service (L3 → L4) |
| A service grows enough that it serves multiple organizations | Extract to a platform (L4 → L5) |

The reverse also applies. A package with one module and one consumer is over-extracted — demote it to a domain directory. A domain directory with two files is over-organized — flatten it. Match the organizational overhead to the actual complexity.

