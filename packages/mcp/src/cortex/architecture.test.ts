/**
 * PRD-066 Track A architecture gates for the Cortex transport subtree.
 *
 *  - G-BOUNDARY:              packages/mcp/src/cortex/** has NO import from @modelcontextprotocol/sdk
 *                             (registration transport is distinct from dispatch transport — C4).
 *  - G-LAYER:                 packages/mcp/src/** has NO value import from @cortex/*
 *                             (Cortex is injected as ctx; only `import type` is allowed — C3).
 *  - G-PORT / G-NO-RUNTIME-DISCOVERY:
 *                             No CallToolRequest-handling file references
 *                             publishMethodology/publishAll/retractMethodology. The publisher is
 *                             composition-root-only — §7.5.
 *  - G-MAP (schema):          mapping module exports a pure function (surfaced in unit tests).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const PKG_ROOT = resolve(import.meta.dirname, "..", "..");
const SRC_ROOT = join(PKG_ROOT, "src");
const CORTEX_ROOT = join(SRC_ROOT, "cortex");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx")))
      out.push(full);
  }
  return out;
}

function allSrcFiles(): string[] {
  return walk(SRC_ROOT);
}

function cortexSrcFiles(): string[] {
  return walk(CORTEX_ROOT).filter((f) => !f.endsWith(".test.ts"));
}

describe("G-BOUNDARY: cortex transport isolates from MCP SDK", () => {
  it("no import of @modelcontextprotocol/sdk in packages/mcp/src/cortex/**", () => {
    const violations: string[] = [];
    for (const file of cortexSrcFiles()) {
      const content = readFileSync(file, "utf-8");
      // Match any import (value or type) from @modelcontextprotocol/sdk.
      if (/from\s+["']@modelcontextprotocol\/sdk/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("G-LAYER: @method/mcp keeps Cortex as injected ctx", () => {
  it("no value import from @cortex/* anywhere in packages/mcp/src/**", () => {
    const violations: string[] = [];
    for (const file of allSrcFiles()) {
      const content = readFileSync(file, "utf-8");
      // Value import (without `import type`). Type-only imports are allowed.
      const matches = content.matchAll(
        /^\s*import\s+([^;]*?)from\s+["']@cortex\/[^"']*["']/gm,
      );
      for (const match of matches) {
        const clause = match[1] ?? "";
        // "import type { ... } from '@cortex/...'" is OK. Everything else is a violation.
        if (!/^\s*type\s/.test(clause)) {
          violations.push(`${file} :: ${match[0].trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("G-PORT / G-NO-RUNTIME-DISCOVERY: publisher is composition-root-only", () => {
  it("no CallToolRequest-handling file references the publisher's methods", () => {
    // The rule: any file OUTSIDE packages/mcp/src/cortex/** that is part of
    // the MCP dispatch path (defines or handles a tool call) MUST NOT
    // reference publishMethodology / publishAll / retractMethodology. The
    // publisher may only be constructed and driven from the composition
    // root (index.ts's main()) — wiring there is allowed because it is
    // startup-only, not a dispatch-path file.
    //
    // Heuristic for "dispatch path": any file under src that imports
    // CallToolRequestSchema from @modelcontextprotocol/sdk, OR any
    // *-tools.ts file (bridge-tools, context-tools, experiment-tools, etc.)
    // Files under src/cortex/** are exempt (they define the publisher).
    // The composition root index.ts is exempt because any future wiring
    // there is startup-only.
    const violations: Array<{ file: string; matches: string[] }> = [];
    const FORBIDDEN = /\b(publishMethodology|publishAll|retractMethodology)\b/g;

    for (const file of allSrcFiles()) {
      if (file.includes(`${"cortex"}${/[\\/]/.source}`) || /[\\/]cortex[\\/]/.test(file))
        continue;
      // Skip the architecture test itself and the composition root.
      if (file.endsWith("architecture.test.ts")) continue;
      if (file === join(SRC_ROOT, "index.ts")) continue;

      const content = readFileSync(file, "utf-8");
      const isDispatchPath =
        /CallToolRequestSchema/.test(content) || /-tools\.ts$/.test(file);
      if (!isDispatchPath) continue;

      const matches = Array.from(content.matchAll(FORBIDDEN)).map((m) => m[0]);
      if (matches.length > 0) {
        violations.push({ file, matches });
      }
    }
    expect(violations).toEqual([]);
  });

  it("the publisher module itself exists and exports createMethodologyToolPublisher", async () => {
    const mod = await import("./methodology-tool-publisher.js");
    expect(typeof mod.createMethodologyToolPublisher).toBe("function");
  });
});

describe("G-MAP: mapping module is a pure function", () => {
  it("exports methodtsToCortex as a function", async () => {
    const mod = await import("./cortex-mapping.js");
    expect(typeof mod.methodtsToCortex).toBe("function");
  });

  it("cortex-mapping.ts has no side-effectful imports (no node:fs, no fetch)", () => {
    const content = readFileSync(
      join(CORTEX_ROOT, "cortex-mapping.ts"),
      "utf-8",
    );
    expect(/from\s+["']node:fs/.test(content)).toBe(false);
    expect(/from\s+["']node:net/.test(content)).toBe(false);
    expect(/from\s+["']node:http/.test(content)).toBe(false);
    // The mapping must not call fetch or import any http client.
    expect(/\bfetch\s*\(/.test(content)).toBe(false);
  });
});
