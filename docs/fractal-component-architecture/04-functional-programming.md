---
title: Why Functional Programming Matters
scope: section
---

# Why Functional Programming Matters

Pure functions are the foundation of the recursion because they are **the only level where the boundary is total.** A pure function cannot see global state, cannot perform I/O, cannot depend on execution order. Its type signature IS its complete interface — nothing is hidden.

Effect systems formalize FCA at L0. In TypeScript's Effect library:

```typescript
Effect<Success, Error, Requirements>
```

- `Success` is the **interface** — what the function promises to produce
- `Error` is the **domain** — the error vocabulary scoped to this computation
- `Requirements` is the **port** — what dependencies must be injected

A function returning `Effect<User, DbError, DatabaseService>` is a fully-specified FCA component at L0: it declares its interface (User), its error domain (DbError), and its port (DatabaseService). This is the same structural discipline that at L3 produces a package with a `package.json` (interface), domain directories (domain), and provider interfaces (ports).

When L0 is pure, every level above benefits:
- **L1 Modules** composed of pure functions are trivially testable — no mocks needed.
- **L2 Domains** composed of pure modules can be reasoned about algebraically — composition is associative, refactoring is safe.
- **L3 Packages** with pure cores only need ports at the edges — the port surface is minimal.
- **L4 Services** with pure domain logic can be tested without infrastructure — only the wiring layer needs integration tests.

Impure foundations make every higher level harder. If L0 functions read from the filesystem, L1 modules need mocks, L2 domains need test fixtures, L3 packages need testkit infrastructure, L4 services need staging environments. The cost of impurity compounds upward through every level.

