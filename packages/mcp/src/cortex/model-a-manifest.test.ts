// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the Model A manifest generator (PRD-066 §7.7).
 *
 * The generator is pure and deterministic. We assert:
 *  - It round-trips the mapping payload (no data loss).
 *  - The emitted yaml is deterministic (byte-for-byte identical on re-run).
 *  - spec.tools / spec.operations blocks contain the expected entries.
 */

import { describe, it, expect } from "vitest";
import type { Tool } from "@methodts/methodts";
import { generateStaticToolsSection } from "./model-a-manifest.js";

const TRUE = { tag: "val" as const, value: true };
const fixtureTools: ReadonlyArray<Tool<unknown>> = [
  {
    id: "read-prd",
    name: "Read PRD",
    description: "Load a PRD document.",
    category: "read",
    precondition: TRUE,
    postcondition: TRUE,
  },
  {
    id: "write-file",
    name: "Write file",
    description: "Write a file.",
    category: "write",
    precondition: TRUE,
    postcondition: TRUE,
  },
];

describe("generateStaticToolsSection", () => {
  it("emits spec/operations/tools blocks populated from the payload", () => {
    const { yaml, payload } = generateStaticToolsSection({
      methodologyId: "P2-SD",
      tools: fixtureTools,
    });
    expect(yaml).toContain("spec:");
    expect(yaml).toContain("operations:");
    expect(yaml).toContain("tools:");
    expect(yaml).toContain("method.P2-SD.read-prd");
    expect(yaml).toContain("method.P2-SD.write-file");
    expect(yaml).toContain("transport: mcp-tool");
    expect(yaml).toContain("write: true");
    expect(yaml).toContain("write: false");
    // Payload exposes structured data for programmatic wiring.
    expect(payload.operations.length).toBe(2);
    expect(payload.tools.length).toBe(2);
  });

  it("emits suggestedPolicy when roleAuthorizations are present", () => {
    const { yaml } = generateStaticToolsSection({
      methodologyId: "P2-SD",
      tools: fixtureTools,
      roleAuthorizations: [
        { roleId: "engineer", authorizedToolIds: ["read-prd", "write-file"] },
      ],
    });
    expect(yaml).toContain("suggestedPolicy:");
    expect(yaml).toContain('role: "engineer"');
    expect(yaml).toContain('- "method.P2-SD.read-prd"');
  });

  it("is deterministic — same input produces byte-identical yaml", () => {
    const a = generateStaticToolsSection({
      methodologyId: "P2-SD",
      tools: fixtureTools,
    });
    const b = generateStaticToolsSection({
      methodologyId: "P2-SD",
      tools: fixtureTools,
    });
    expect(a.yaml).toBe(b.yaml);
  });
});
