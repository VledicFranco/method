---
title: Principles
scope: section
---

# Principles

The following principles are concrete rules derived from the component model. Each principle applies at every level, but the examples emphasize L2-L4 where most day-to-day development happens.

### 1. Every layer produces a component

Every distinct concern becomes a component with its own interface, boundary, verification, and documentation. At L3 this means a package with `package.json`, tests, and `documentation/`. At L2 this means a domain directory with `index.ts`, `README.md`, and co-located tests. At L0 this means a function with a clear type signature and JSDoc.

The dependency graph between components is a DAG. Circular dependencies are architecture bugs.

### 2. Interface discipline

Every component's interface is a commitment. Treat it as a library maintainer would:

- **Explicit surface.** Only expose what consumers need. Internal helpers stay internal. At L3 the package's `index.ts` is its interface. At L1 the module's `export` declarations are its interface. At L0 the function's type signature is its interface.
- **Semantic versioning mindset.** Breaking changes to the interface require migration paths. "We control both sides" doesn't mean consumers don't exist — it means migration cost is lower, not zero.
- **Deprecation over deletion.** When an interface element evolves, deprecate the old form for one release cycle.

The practical test: if you changed an interface element and 4 consumers broke, that's fine. If 40 broke, the boundary is leaking.

### 3. Port pattern as the standard seam

External dependencies are accessed through ports. The port is both the testing seam and the substitution point.

```typescript
// Port definition (lives in the component)
interface AgentProvider {
  execute(request: AgentRequest): Promise<AgentResponse>;
}

// Port implementation (lives in the consumer or a separate component)
class ClaudeCodeProvider implements AgentProvider { ... }

// Verification double (lives in the testkit)
class RecordingProvider implements AgentProvider { ... }
```

Rules:
- The port definition lives in the component. The implementation lives outside.
- The port is minimal — it defines what the component needs, not the full capability of the external system.
- Every port has at least two implementations: production and test. If a test double takes more than 20 lines, the port is too wide.

At L0, a port is a function parameter. At L2, a provider interface. At L4, an environment variable pointing to an upstream service. Same pattern, different mechanism.

### 4. Every component ships verification affordances

A component's verification infrastructure is part of its interface — not an afterthought. At L3 this means a testkit package with builders, assertions, harnesses, and recording providers. At L2 this means test doubles and fixtures co-located in the domain. At L0 this means the function is pure and can be called directly.

```typescript
import { methodBuilder, scriptStep, assertCompiles, runStepIsolated } from '@method/testkit';

const method = methodBuilder('M-TEST')
  .addStep(scriptStep('s0', { script: async () => ({ ok: true }) }))
  .build();

assertCompiles(method);
const result = await runStepIsolated(method, 's0', {});
assert.equal(result.output.ok, true);
```

If testing with a component is hard, the component's design is wrong.

### 5. The highest-level component is pure composition

The component at the top of any local hierarchy is a thin composition layer. At L4, the application selects packages, wires port implementations, configures via environment, and exposes the result. At L3, the package's `index.ts` re-exports from domain directories. At L2, the domain's `index.ts` re-exports from modules.

No composition layer contains domain logic. If business rules appear in a route handler, they belong in a lower-level component. Route handlers parse input, call a component, and format output.

```typescript
// L4 composition: thin wiring
app.get('/api/tokens', async (_request, reply) => {
  const aggregate = tokenTracker.getAggregate();  // Delegates to component
  return reply.status(200).send(aggregate);        // Formats output
});
```

### 6. Verify independently, integrate minimally

Each component's verification runs in isolation:
- Uses only its own verification affordances (and its dependencies' affordances) for setup.
- Never requires a higher-level component to be running.
- Never touches external systems unless that IS the component's concern (and even then, through a port).
- Runs in under 5 seconds for unit verification. Integration verification is separated and tagged.

Integration verification exists at the composition level and tests wiring — not logic. If integration verification fails, the bug is in the wiring or in a missing unit verification.

### 7. Enforce boundaries through structure

The directory structure IS the architecture. Violations are import errors, not code review comments.

- **Circular dependency = architecture bug.** Extract the shared concern or reverse the direction.
- **Transport independence for domain components.** The core domain component has zero transport dependencies. It doesn't know how it's being called.
- **Shared types live in a types component.** When two components need the same type but neither should depend on the other, the type moves to a shared component both depend on.

### 8. Co-locate all artifacts

Every artifact that describes, verifies, observes, configures, or documents a component lives **with** that component — not in a parallel directory tree organized by artifact type.

The conventional layout organizes by artifact type:

```
source/            # implementation goes here
__tests__/         # verification goes over there
docs/              # documentation goes somewhere else
dashboards/        # observability in yet another place
config/            # configuration schemas elsewhere
```

Every artifact about the pool is scattered across the tree. To understand the pool, you visit five directories. FCA inverts this: **co-location is the natural state; separation is a build concern.**

#### The seven co-located artifacts

Every component, from L0 upward, can carry these artifacts:

| Artifact | What it is | L0 (function) | L2 (domain) | L3 (package) |
|----------|-----------|---------------|-------------|-------------|
| **Implementation** | The code itself | `pool.ts` | `pool/` directory | `source/` tree |
| **Types** | Interface definitions | Type signature + ADTs | `index.ts` re-exports | `index.ts` public API |
| **Verification** | Tests that prove correctness | `pool.test.ts` next to `pool.ts` | `*.test.ts` per module | `tests/` directory |
| **Documentation** | Explanation of intent and usage | JSDoc above the function | `README.md` in directory | `documentation/` directory |
| **Observability** | Metric, span, and log definitions | `pool.metrics.ts` | `*.metrics.ts` per module | `observability/` directory |
| **Configuration** | Config schema, defaults, validation | `pool.config.ts` | `*.config.ts` per module | `configuration/` directory |
| **Examples** | Usage demonstrations (also serve as integration tests) | `pool.example.ts` | `examples/` directory | `examples/` directory |

At L0-L1, these are files next to the implementation. At L2-L3, they are directories within the component. At L4-L5, they may be separate repositories — but still co-located with the service they describe.

#### Co-located layout at L2 (domain)

```
source/pool/
  pool.ts                   # Implementation
  pool.test.ts              # Verification — unit tests right next to the code
  pool.metrics.ts           # Observability — span/metric definitions
  pool.config.ts            # Configuration — schema, defaults, env var mapping
  pool.example.ts           # Examples — usage demos, also integration tests
  README.md                 # Documentation — what this module does
```

#### Co-located layout at L3 (package)

```
packages/session-pool/
  source/
    README.md                                # Architecture: modules, ports, entry point
    pool.ts                                  # Implementation
    pool.test.ts                             # Verification — unit tests co-located
    pool.metrics.ts                          # Observability — metric definitions co-located
    pool.config.ts                           # Configuration — schema co-located
    providers/
      README.md                              # Port definitions
      session-provider.ts
      session-provider.test.ts
  documentation/
    README.md                                # Component front door: what, why, quick start
    guides/
      README.md                              # Guide index with audience + summary table
      spawning-sessions.md
      implementing-providers.md
    decisions/
      README.md                              # Decision log index
      001-pty-over-child-process.md
  examples/
    README.md                                # Example index
    basic-spawn.ts
    custom-provider.ts
  package.json
```

#### Build separation

Co-location is for authoring. Deployment requires separation. **Build tools** extract co-located artifacts into purpose-specific outputs:

| Build mode | Includes | Produces |
|-----------|----------|---------|
| `build:runtime` | Implementation, types, config runtime code | Deployable bundle — no tests, no docs, no metric definitions |
| `build:test` | Everything | Test runner environment — full source with all verification artifacts |
| `build:docs` | README files, JSDoc, types, examples | Documentation site — navigable, rendered |
| `build:observe` | Metric definitions, span schemas, config | Observability package — Grafana dashboards, alert rules, trace schemas |
| `build:types` | Type exports only | `.d.ts` declaration package — for consumers who only need the interface |

The key principle: **authors co-locate; tools separate.** A developer editing `pool.ts` sees `pool.test.ts` and `pool.metrics.ts` right next to it. They update all three in the same commit. The build system strips what each deployment target doesn't need.

#### Language precedent

This is not aspirational — other ecosystems already do it:

- **Rust**: `#[cfg(test)] mod tests { ... }` lives inside the source file. `cargo build` strips it. `cargo test` includes it. Tests are co-located at the function level by default.
- **Go**: `pool_test.go` lives next to `pool.go`. `go build` ignores `_test.go` files. `go test` discovers them.
- **Elixir**: doctests are executable examples embedded in function documentation. They serve as both documentation and verification simultaneously.
- **Python**: doctests in docstrings. Same pattern.

TypeScript lacks standard tooling for this. The FCA approach uses file naming conventions (`*.test.ts`, `*.metrics.ts`, `*.config.ts`, `*.example.ts`) that build tools can filter by glob pattern. A Vite or esbuild plugin strips `*.test.ts` and `*.metrics.ts` from production builds. A test runner discovers `*.test.ts` anywhere in the source tree. An observability extractor reads `*.metrics.ts` and generates Grafana JSON or OpenTelemetry schemas.

### 9. Every component is observable

Observability is not something added after the component works. It is a structural part of the component, defined alongside the implementation.

At each level, a component declares what signals it emits:

**L0 (Function):** Effect traces or spans that record computation duration, inputs, outputs, and callees.

**L1 (Module):** Structured log emissions, counters (operations per second), gauges (queue depth), histograms (latency distribution).

**L2 (Domain):** Domain events emitted to an event bus — state transitions, decisions made, anomalies detected. These are semantic, not infrastructural: "methodology session advanced to step sigma_3" rather than "function X called."

**L3 (Package):** Exported event streams, channel systems, retrospectives. The observability artifacts ship as part of the package — metric definitions in `*.metrics.ts`, dashboard templates in `observability/`, health check endpoints in the interface.

**L4 (Service):** HTTP access logs, health endpoints (`/health`), readiness probes, request tracing, dashboards. The service's observability is its window — operators watch it to understand behavior, not just to detect failures.

**L5 (System):** Distributed tracing across services, SLO dashboards, incident timelines, capacity planning metrics. Cross-service observability reveals interaction patterns that no single service's metrics can show.

**The distinction from verification:** verification is active — you run it and get a pass/fail result. Observability is passive — it emits continuously while the component operates. Verification answers "is it correct?" Observability answers "what is it doing?" Both are needed. A component that passes all tests but has no observability is a black box in production.

### 10. Progressive disclosure through README indexing

Every directory with more than one file has a `README.md` that indexes its children. A reader navigates by reading the README at the current level and following links deeper only when they need to.

#### The README convention

Every README has frontmatter for programmatic navigation:

```markdown
---
title: Session Pool — Guides
scope: package
package: session-pool
contents:
  - spawning-sessions.md
  - implementing-providers.md
  - testing-with-session-pool.md
---

# Session Pool Guides

| Guide | Audience | Summary |
|-------|----------|---------|
| [Spawning Sessions](spawning-sessions.md) | Consumers | How to spawn and manage PTY sessions |
| [Implementing Providers](implementing-providers.md) | Extenders | How to write a custom provider |
| [Testing](testing-with-session-pool.md) | Testers | How to test code that uses this component |
```

The frontmatter enables programmatic navigation. An LLM agent can scan READMEs to find the right file without globbing the entire tree. A documentation generator can build a site from the index.

#### Progressive disclosure through depth

| Depth | What you learn | Time |
|-------|---------------|------|
| `ls packages/` | What components exist | 1 second |
| `cat packages/session-pool/documentation/README.md` | What the component does and offers | 30 seconds |
| `cat packages/session-pool/documentation/guides/README.md` | What guides exist and who they're for | 10 seconds |
| `cat packages/session-pool/documentation/guides/spawning-sessions.md` | Full detail on one use case | 5 minutes |
| `cat packages/session-pool/source/README.md` | How the architecture is organized | 30 seconds |

At every level, you learn enough to decide whether to go deeper.

#### Scope rule

Artifact scope matches component scope. A component's documentation never references another component's architecture. The composition level's documentation explains how components are wired, not how they work internally.

#### Self-containment test

Can you copy a component's directory and understand it from its contents alone? The READMEs orient you. The guides explain usage. The types define the interface. The tests demonstrate behavior. The metrics define what to observe. The config defines how to tune it. The examples show how to use it. If you need to read a sibling component's files, the co-location is incomplete.

# Anti-Patterns

### "We control both sides"
The most dangerous phrase in internal software. It justifies skipping interface discipline, inlining dependencies, and building untestable monoliths. FCA removes this escape hatch by treating every component as if its consumers are external.

### The god component
One component that everything depends on and that depends on everything. Usually called `core/` or `common/`. The fix: split by domain. A "core" component should contain one domain's logic and nothing else.

### Verification-after affordances
"We'll add a testkit when someone needs it." By then, every consumer has built ad-hoc test doubles — all slightly different, all maintaining their own copies of domain knowledge. Verification affordances ship with the component, not after it.

### Port-shaped wrappers with no interface
```typescript
class DatabaseWrapper {
  constructor(private connectionString: string) { ... }
}
```
A wrapper without an interface is just indirection. The value of the port pattern is the interface that enables substitution. No interface, no seam, no testability.

### Central documentation
Documentation in a root folder describing all components. This drifts because the person editing the component doesn't see it. Component documentation lives in the component.

### Artifact-type directories
```
source/          # all implementation here
__tests__/       # all tests here
docs/            # all documentation here
```
Organizing by artifact type instead of by component scatters related artifacts across the tree. FCA co-locates: `pool.ts`, `pool.test.ts`, `pool.metrics.ts`, and `README.md` live together. Build tools separate for deployment.

### Observability as afterthought
"We'll add metrics when we hit production." By then, the component is a black box. Observability definitions (`*.metrics.ts`) ship with the implementation — they describe what the component does, not just whether it's alive. A health endpoint is not observability; it's a liveness check. Observability reveals behavior, patterns, and opportunities.

---

