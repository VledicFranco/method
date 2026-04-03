/**
 * Tests for design and review SPL algorithms.
 *
 * Uses RecordingProvider for deterministic replay.
 * Real LLM tests are in the experiment harness.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { runSemantic } from "../run.js";
import { designLevel } from "../algorithms/design.js";
import { reviewLevel } from "../algorithms/review.js";
import { SequenceProvider } from "../../testkit/provider/recording-provider.js";

// ── Design tests ──

describe("designLevel", () => {
  it("produces draft documentation and ports from LLM output", async () => {
    const { layer } = SequenceProvider([{
      raw: `DOCUMENTATION:
# Session Pool

A pool manager for PTY sessions. Provides lifecycle management (spawn, kill, list)
and resource limits (max concurrent sessions). Exposes a SessionPoolPort for consumers.

## Usage
\`\`\`typescript
const pool = createSessionPool(config);
await pool.spawn({ prompt: "hello" });
\`\`\`

PORTS:
PORT SessionPoolPort
owner: session-pool
consumer: bridge-routes
description: Spawn, list, and kill PTY sessions
interface: interface SessionPoolPort {
  spawn(opts: SpawnOpts): Promise<Session>;
  kill(id: string): Promise<void>;
  list(): Promise<Session[]>;
}
END_PORT

SUB_COMPONENTS:
- pool-core | Pure pool logic (capacity, lifecycle state machine) | ports: SessionPoolPort
- pty-adapter | PTY process management | ports: SessionPoolPort

ARCHITECTURE:
pool-core manages capacity and state. pty-adapter wraps node-pty behind SessionPoolPort.
Routes call pool-core which delegates to pty-adapter for actual process management.`,
      cost: { tokens: 120, usd: 0.002, duration_ms: 300 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: "Build a session pool for managing PTY sessions",
        path: "/packages/bridge/src/domains/sessions",
        level: 2,
        existingDocs: "",
        existingChildren: [],
        constraints: ["All external deps through ports", "Co-locate tests"],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("complete");
    expect(result.data.draftDocumentation).toContain("Session Pool");
    expect(result.data.ports).toHaveLength(1);
    expect(result.data.ports[0].name).toBe("SessionPoolPort");
    expect(result.data.ports[0].methods).toContain("spawn");
    expect(result.data.subComponents).toHaveLength(2);
    expect(result.data.subComponents[0].name).toBe("pool-core");
  });

  it("handles leaf components with no ports or sub-components", async () => {
    const { layer } = SequenceProvider([{
      raw: `DOCUMENTATION:
# formatTokens

Pure utility function that formats token counts into human-readable strings.
E.g., 1500 → "1.5k", 1000000 → "1.0M".

PORTS: (none)

SUB_COMPONENTS: (none)

ARCHITECTURE:
Single pure function with pattern matching on magnitude thresholds.`,
      cost: { tokens: 40, usd: 0.001, duration_ms: 100 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(designLevel, {
        requirement: "Format token counts for display",
        path: "/packages/methodts/src/runtime/format-tokens.ts",
        level: 0,
        existingDocs: "",
        existingChildren: [],
        constraints: [],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.ports).toHaveLength(0);
    expect(result.data.subComponents).toHaveLength(0);
    expect(result.data.draftDocumentation).toContain("formatTokens");
  });
});

// ── Review tests ──

describe("reviewLevel", () => {
  it("produces findings in FCD priority order", async () => {
    const { layer } = SequenceProvider([{
      raw: `FINDINGS:
F-1 | high | port | Direct import of 'node:fs' in domain code — should use FileSystemPort | Replace with port injection
F-2 | medium | interface | Exported function lacks return type annotation | Add explicit return type
F-3 | low | architecture | Helper function could be extracted to reduce complexity | Extract to separate module

FLAGGED_CHILDREN:
utils: Direct fs usage suggests port violations may propagate

SUMMARY:
Port violation detected: direct fs import bypasses the FileSystemPort. Interface has a minor typing gap. Architecture is generally clean.`,
      cost: { tokens: 80, usd: 0.002, duration_ms: 200 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(reviewLevel, {
        path: "/packages/bridge/src/domains/registry",
        level: 2,
        content: "import { readFileSync } from 'node:fs';\n// ... domain code ...",
        portContext: "FileSystemPort: { read, write, exists }",
        children: ["utils", "routes"],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("complete");
    expect(result.data.findings).toHaveLength(3);
    // Findings should be in FCD priority: port > interface > architecture
    expect(result.data.findings[0].category).toBe("port");
    expect(result.data.findings[1].category).toBe("interface");
    expect(result.data.findings[2].category).toBe("architecture");
    // Port findings at medium should be escalated to high
    expect(result.data.findings[0].severity).toBe("high");
    // Flagged children
    expect(result.data.flaggedChildren).toContain("utils");
    expect(result.data.summary).toContain("Port violation");
  });

  it("handles clean code with no findings", async () => {
    const { layer } = SequenceProvider([{
      raw: `FINDINGS: (none)

FLAGGED_CHILDREN: (none)

SUMMARY:
Clean component. All external dependencies accessed through ports. Types are well-defined. No architecture issues detected.`,
      cost: { tokens: 30, usd: 0.001, duration_ms: 80 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(reviewLevel, {
        path: "/packages/methodts/src/prompt",
        level: 1,
        content: "export class Prompt<A> { constructor(public readonly run: (a: A) => string) {} }",
        portContext: "",
        children: [],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.findings).toHaveLength(0);
    expect(result.data.flaggedChildren).toHaveLength(0);
    expect(result.data.summary).toContain("Clean");
  });

  it("escalates port findings from medium to high", async () => {
    const { layer } = SequenceProvider([{
      raw: `FINDINGS:
F-1 | medium | port | Shared type redefined locally instead of importing from canonical package | Import from @method/types

FLAGGED_CHILDREN: (none)

SUMMARY:
Entity drift detected — local type definition shadows canonical package type.`,
      cost: { tokens: 40, usd: 0.001, duration_ms: 100 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(reviewLevel, {
        path: "/packages/bridge/src/domains/strategies",
        level: 2,
        content: "interface StrategyNode { id: string; type: string; }",
        portContext: "Canonical: @method/types defines StrategyNode",
        children: [],
      }).pipe(Effect.provide(layer)),
    );

    // Medium port finding should be escalated to high
    expect(result.data.findings[0].severity).toBe("high");
    expect(result.data.findings[0].category).toBe("port");
  });
});
