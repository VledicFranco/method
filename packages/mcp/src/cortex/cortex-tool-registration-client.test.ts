/**
 * Tests for `CortexToolRegistrationClient` construction (PRD-066 Track A).
 *
 * Track A validates the constructor surface:
 *  - Throws `MissingCtxError` when `ctx.auth.issueServiceToken` is absent.
 *  - Successfully constructs when the token issuer is present.
 *  - Track B methods throw `NotImplementedError` pinned to O5/O7 until
 *    Cortex unblocks.
 */

import { describe, it, expect } from "vitest";
import {
  createCortexToolRegistrationClient,
} from "./cortex-tool-registration-client.js";
import { MissingCtxError, NotImplementedError } from "./types.js";

function validCtx() {
  return {
    app: { id: "tenant-app" },
    auth: {
      issueServiceToken: async () => ({
        token: "fake-token",
        expiresAt: Date.now() + 60_000,
      }),
    },
  };
}

describe("createCortexToolRegistrationClient — construction", () => {
  it("throws MissingCtxError when ctx.auth.issueServiceToken is absent", () => {
    expect(() =>
      createCortexToolRegistrationClient({
        ctx: { app: { id: "a" }, auth: {} },
        baseUrl: "http://cortex.t1.local",
      }),
    ).toThrow(MissingCtxError);
  });

  it("throws MissingCtxError when ctx.auth is itself absent", () => {
    expect(() =>
      createCortexToolRegistrationClient({
        // cast — deliberately bad input for the guard.
        ctx: { app: { id: "a" } } as unknown as ReturnType<typeof validCtx>,
        baseUrl: "http://cortex.t1.local",
      }),
    ).toThrow(MissingCtxError);
  });

  it("requires baseUrl", () => {
    expect(() =>
      createCortexToolRegistrationClient({
        ctx: validCtx(),
        baseUrl: "",
      }),
    ).toThrow();
  });

  it("constructs successfully when ctx.auth.issueServiceToken is present", () => {
    const client = createCortexToolRegistrationClient({
      ctx: validCtx(),
      baseUrl: "http://cortex.t1.local",
    });
    expect(client).toBeDefined();
    expect(typeof client.replaceAll).toBe("function");
    expect(typeof client.publish).toBe("function");
    expect(typeof client.retract).toBe("function");
    expect(typeof client.list).toBe("function");
  });
});

describe("CortexToolRegistrationClient — Track B placeholders", () => {
  const client = createCortexToolRegistrationClient({
    ctx: validCtx(),
    baseUrl: "http://cortex.t1.local",
  });

  it("replaceAll throws NotImplementedError referencing O5", async () => {
    await expect(
      client.replaceAll({ operations: [], tools: [] }),
    ).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O5"),
    });
  });

  it("publish throws NotImplementedError referencing O5", async () => {
    await expect(
      client.publish("P2-SD", { operations: [], tools: [] }),
    ).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O5"),
    });
  });

  it("retract throws NotImplementedError referencing O7", async () => {
    await expect(client.retract("P2-SD")).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O7"),
    });
  });

  it("list throws NotImplementedError referencing O5", async () => {
    await expect(client.list()).rejects.toMatchObject({
      name: "NotImplementedError",
      message: expect.stringContaining("O5"),
    });
  });

  it("NotImplementedError is a distinct error class", () => {
    const err = new NotImplementedError("x");
    expect(err.name).toBe("NotImplementedError");
    expect(err).toBeInstanceOf(Error);
  });
});
