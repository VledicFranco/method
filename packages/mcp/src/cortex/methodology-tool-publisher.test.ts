/**
 * Tests for `MethodologyToolPublisher` (PRD-066 Track A).
 *
 *  - manifest mode: publishAll is a no-op verifier, returns one report
 *    per methodology, and never touches the client.
 *  - dynamic mode: Track B. publishAll warns once and returns 'pending-approval'.
 *  - publishMethodology / retractMethodology: NotImplementedError pinned to O-codes.
 *  - standalone bridge mode is modeled by NOT constructing the publisher
 *    at all (caller responsibility); tested at composition-root via
 *    architecture gate rather than here.
 */

import { describe, it, expect, vi } from "vitest";
import { createMethodologyToolPublisher } from "./methodology-tool-publisher.js";
import type { CortexToolRegistrationClient } from "./cortex-tool-registration-client.js";
import type {
  MethodologySourceView,
  CortexToolDescriptor,
} from "./types.js";

function fakeClient(): CortexToolRegistrationClient {
  return {
    replaceAll: vi.fn(async () => ({
      registered: 0,
      updated: 0,
      deprecated: 0,
      state: "active" as const,
      requestId: "r",
    })),
    publish: vi.fn(async () => ({
      registered: 0,
      updated: 0,
      deprecated: 0,
      state: "active" as const,
      requestId: "r",
    })),
    retract: vi.fn(async () => ({ retracted: 0, notFound: 0 })),
    list: vi.fn(async () => ({
      toolNames: [],
      operationNames: [],
      byMethodology: {},
    })),
  };
}

function fakeSource(ids: string[]): MethodologySourceView {
  return {
    list: async () => ids.map((id) => ({ id })),
  };
}

const MANIFEST_TOOLS: ReadonlyArray<CortexToolDescriptor> = [
  {
    name: "method.P2-SD.read-prd",
    operation: "method.P2-SD.read-prd",
    description: "Read a PRD.",
    inputSchema: { type: "object" },
  },
];

describe("MethodologyToolPublisher — manifest mode (Model A default)", () => {
  it("publishAll is a no-op verifier — never calls the client", async () => {
    const client = fakeClient();
    const publisher = createMethodologyToolPublisher({
      client,
      methodologySource: fakeSource(["P2-SD", "P0-META"]),
      mode: "manifest",
      manifestTools: MANIFEST_TOOLS,
    });
    const reports = await publisher.publishAll();
    expect(reports.length).toBe(2);
    expect(reports.every((r) => r.toolsPublished === 0)).toBe(true);
    expect(reports.every((r) => r.state === "active")).toBe(true);
    expect(client.publish).not.toHaveBeenCalled();
    expect(client.replaceAll).not.toHaveBeenCalled();
  });

  it("throws when manifestTools are not provided", () => {
    expect(() =>
      createMethodologyToolPublisher({
        client: fakeClient(),
        methodologySource: fakeSource([]),
        mode: "manifest",
      }),
    ).toThrow(/manifestTools/);
  });

  it("emits an info log when the log facade is present", async () => {
    const info = vi.fn();
    const publisher = createMethodologyToolPublisher({
      client: fakeClient(),
      methodologySource: fakeSource(["P2-SD"]),
      mode: "manifest",
      manifestTools: MANIFEST_TOOLS,
      ctxLog: { info, warn: vi.fn(), error: vi.fn() },
    });
    await publisher.publishAll();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toMatch(/manifest mode/i);
  });
});

describe("MethodologyToolPublisher — dynamic mode (Track B — blocked on O5)", () => {
  it("publishAll warns once and returns pending-approval reports", async () => {
    const warn = vi.fn();
    const publisher = createMethodologyToolPublisher({
      client: fakeClient(),
      methodologySource: fakeSource(["P2-SD", "P0-META"]),
      mode: "dynamic",
      ctxLog: { info: vi.fn(), warn, error: vi.fn() },
    });
    const reports1 = await publisher.publishAll();
    const reports2 = await publisher.publishAll();
    // warn only once
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/dynamic mode/i);
    expect(warn.mock.calls[0][0]).toMatch(/O5/);
    expect(reports1.every((r) => r.state === "pending-approval")).toBe(true);
    expect(reports2.every((r) => r.state === "pending-approval")).toBe(true);
  });
});

describe("MethodologyToolPublisher — Track B stubs (O5/O7)", () => {
  const publisher = createMethodologyToolPublisher({
    client: fakeClient(),
    methodologySource: fakeSource([]),
    mode: "manifest",
    manifestTools: MANIFEST_TOOLS,
  });

  it("publishMethodology throws NotImplementedError referencing O5", async () => {
    await expect(publisher.publishMethodology("P2-SD")).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O5"),
    });
  });

  it("retractMethodology throws NotImplementedError referencing O7", async () => {
    await expect(
      publisher.retractMethodology("P2-SD"),
    ).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O7"),
    });
  });
});

describe("MethodologyToolPublisher — dispose lifecycle", () => {
  it("dispose marks publisher as disposed; later publishAll throws", async () => {
    const publisher = createMethodologyToolPublisher({
      client: fakeClient(),
      methodologySource: fakeSource(["P2-SD"]),
      mode: "manifest",
      manifestTools: MANIFEST_TOOLS,
    });
    await publisher.dispose();
    await expect(publisher.publishAll()).rejects.toThrow(/disposed/);
  });
});
