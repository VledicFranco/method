// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for `methodtsToCortex` pure mapping (PRD-066 Track A).
 *
 * Covers:
 *  - Gate G-MAP: output names are globally unique.
 *  - Mapping-table key rows from S9 §4.3 (name prefix, category → write,
 *    transport constant, 1-operation-per-tool, role → suggestedPolicy).
 *  - Determinism: repeated calls with the same input yield identical output.
 *  - Error paths: invalid methodology id, invalid tool id, duplicate tool ids.
 */

import { describe, it, expect } from "vitest";
import type { Tool } from "@methodts/methodts";
import { methodtsToCortex, qualifiedToolName } from "./cortex-mapping.js";

// A small P2-SD-shaped fixture. Stand-in: two read tools, one write, one
// execute, one communicate — exercises every category branch.
const TRUE_PRED = { tag: "val" as const, value: true };
function tool<S>(
  id: string,
  name: string,
  description: string,
  category: Tool<S>["category"],
): Tool<S> {
  return {
    id,
    name,
    description,
    category,
    precondition: TRUE_PRED,
    postcondition: TRUE_PRED,
  };
}

const fixtureMethodologyP2SD = {
  methodologyId: "P2-SD",
  tools: [
    tool("read-prd", "Read PRD", "Load a PRD document and return its sections.", "read"),
    tool("list-files", "List files", "List files in a directory.", "read"),
    tool("write-file", "Write file", "Write a file to disk.", "write"),
    tool("run-tests", "Run tests", "Execute the test suite.", "execute"),
    tool("notify", "Notify", "Send a notification.", "communicate"),
  ] as ReadonlyArray<Tool<unknown>>,
  roleAuthorizations: [
    { roleId: "engineer", authorizedToolIds: ["read-prd", "list-files", "write-file", "run-tests"] },
    { roleId: "reviewer", authorizedToolIds: ["read-prd", "list-files"] },
    { roleId: "absent-role", authorizedToolIds: ["not-a-tool"] }, // filtered out
  ],
} as const;

describe("methodtsToCortex — frozen mapping (S9 §4.3)", () => {
  it("emits method.<methodologyId>.<toolId> names for every tool", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    const names = out.tools.map((t) => t.name);
    expect(names).toContain("method.P2-SD.read-prd");
    expect(names).toContain("method.P2-SD.list-files");
    expect(names).toContain("method.P2-SD.write-file");
    expect(names).toContain("method.P2-SD.run-tests");
    expect(names).toContain("method.P2-SD.notify");
  });

  it("uses transport='mcp-tool' for every operation", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    for (const op of out.operations) {
      expect(op.transport).toBe("mcp-tool");
    }
  });

  it("maps categories write/execute → write: true and read/communicate → write: false", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    const writeMap = new Map(out.operations.map((op) => [op.name, op.write]));
    expect(writeMap.get("method.P2-SD.read-prd")).toBe(false);
    expect(writeMap.get("method.P2-SD.list-files")).toBe(false);
    expect(writeMap.get("method.P2-SD.write-file")).toBe(true);
    expect(writeMap.get("method.P2-SD.run-tests")).toBe(true);
    expect(writeMap.get("method.P2-SD.notify")).toBe(false);
  });

  it("emits exactly one operation per tool, with 1:1 name/operation binding", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    expect(out.operations.length).toBe(fixtureMethodologyP2SD.tools.length);
    expect(out.tools.length).toBe(fixtureMethodologyP2SD.tools.length);
    for (const descriptor of out.tools) {
      expect(descriptor.operation).toBe(descriptor.name);
    }
  });

  it("attaches scope.methodologyId on every operation (for Track B retract)", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    for (const op of out.operations) {
      expect(op.scope).toEqual({ methodologyId: "P2-SD" });
    }
  });

  it("copies Tool.name → ToolDescriptor.displayName and Tool.description to both sides", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    const readPrdOp = out.operations.find((o) => o.name === "method.P2-SD.read-prd")!;
    const readPrdTool = out.tools.find((t) => t.name === "method.P2-SD.read-prd")!;
    expect(readPrdTool.displayName).toBe("Read PRD");
    expect(readPrdTool.description).toBe(
      "Load a PRD document and return its sections.",
    );
    expect(readPrdOp.description).toBe(readPrdTool.description);
  });

  it("emits suggestedPolicy[] from roleAuthorizations, skipping unknown tool ids", () => {
    const out = methodtsToCortex(fixtureMethodologyP2SD);
    expect(out.suggestedPolicy).toBeDefined();
    const byRole = new Map(out.suggestedPolicy!.map((r) => [r.role, r.operations]));
    expect(byRole.get("engineer")).toEqual([
      "method.P2-SD.read-prd",
      "method.P2-SD.list-files",
      "method.P2-SD.write-file",
      "method.P2-SD.run-tests",
    ]);
    expect(byRole.get("reviewer")).toEqual([
      "method.P2-SD.read-prd",
      "method.P2-SD.list-files",
    ]);
    // absent-role's single authorizedToolId does not match any tool — dropped entirely.
    expect(byRole.has("absent-role")).toBe(false);
  });

  it("uses declared inputSchema/outputSchema when provided", () => {
    const out = methodtsToCortex({
      ...fixtureMethodologyP2SD,
      schemas: [
        {
          toolId: "read-prd",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          outputSchema: { type: "object", properties: { sections: { type: "array" } } },
        },
      ],
    });
    const readPrd = out.tools.find((t) => t.name === "method.P2-SD.read-prd")!;
    expect(readPrd.inputSchema).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    });
    expect(readPrd.outputSchema).toEqual({
      type: "object",
      properties: { sections: { type: "array" } },
    });
  });

  it("emits generic { type: 'object' } + onWarn for tools missing inputSchema", () => {
    const warnings: string[] = [];
    const out = methodtsToCortex({
      ...fixtureMethodologyP2SD,
      onWarn: (m) => warnings.push(m),
    });
    // Every tool lacks a declared schema → one warning per tool.
    expect(warnings.length).toBe(fixtureMethodologyP2SD.tools.length);
    for (const tool of out.tools) {
      expect(tool.inputSchema).toEqual({ type: "object" });
    }
  });

  it("is deterministic — repeated calls produce identical output", () => {
    const a = methodtsToCortex(fixtureMethodologyP2SD);
    const b = methodtsToCortex(fixtureMethodologyP2SD);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("G-MAP — output is unique-named", () => {
  it("no two operations share a name", () => {
    const payload = methodtsToCortex(fixtureMethodologyP2SD);
    const names = payload.operations.map((o) => o.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("no two tool descriptors share a name", () => {
    const payload = methodtsToCortex(fixtureMethodologyP2SD);
    const names = payload.tools.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("throws RangeError when two tools would produce the same qualified name", () => {
    const colliding = [
      tool("foo", "Foo", "d", "read"),
      tool("foo", "Foo dup", "d", "read"),
    ] as ReadonlyArray<Tool<unknown>>;
    expect(() =>
      methodtsToCortex({
        methodologyId: "X",
        tools: colliding,
        roleAuthorizations: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("qualifiedToolName — sanitization + segment validation", () => {
  it("replaces ':' with '.' per Cortex name rules", () => {
    expect(qualifiedToolName("P2-SD", "ns:tool")).toBe("method.P2-SD.ns.tool");
  });

  it("rejects invalid tool-id segments (post-sanitization)", () => {
    expect(() => qualifiedToolName("P2-SD", "bad tool")).toThrow(RangeError);
    expect(() => qualifiedToolName("P2-SD", "")).toThrow(RangeError);
  });

  it("methodtsToCortex rejects invalid methodology ids", () => {
    expect(() =>
      methodtsToCortex({
        methodologyId: "bad id",
        tools: [],
        roleAuthorizations: [],
      }),
    ).toThrow(RangeError);
  });
});
