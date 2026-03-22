/**
 * HttpService tests.
 *
 * Validates: HttpServiceTest (canned responses), error construction,
 * HttpResponse construction, JSON parsing.
 *
 * PRD Component 8: Extractor framework — service layer.
 */

import { describe, it, expect } from "vitest";
import { Effect, pipe } from "effect";
import {
  HttpService,
  HttpServiceTest,
} from "../services/http.js";
import type { HttpError, HttpResponse } from "../services/http.js";

// ── Test layer setup ──

const cannedResponses: Record<string, HttpResponse> = {
  "https://api.example.com/data": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"items": [1, 2, 3], "total": 3}',
  },
  "https://api.example.com/text": {
    status: 200,
    headers: { "content-type": "text/plain" },
    body: "Hello, World!",
  },
  "https://api.example.com/post-endpoint": {
    status: 201,
    headers: { "content-type": "application/json" },
    body: '{"created": true}',
  },
};

const testLayer = HttpServiceTest(cannedResponses);

// ── GET ──

describe("HttpServiceTest — get", () => {
  it("returns canned response for known URL", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) => svc.get("https://api.example.com/text")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result.status).toBe(200);
    expect(result.body).toBe("Hello, World!");
    expect(result.headers["content-type"]).toBe("text/plain");
  });

  it("fails for unknown URL", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) => svc.get("https://unknown.example.com")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as HttpError;
      expect(err._tag).toBe("HttpError");
      expect(err.url).toBe("https://unknown.example.com");
      expect(err.method).toBe("GET");
      expect(err.message).toBe("No mock response");
    }
  });
});

// ── POST ──

describe("HttpServiceTest — post", () => {
  it("returns canned response for known URL", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) =>
        svc.post("https://api.example.com/post-endpoint", '{"key": "value"}'),
      ),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result.status).toBe(201);
    expect(result.body).toBe('{"created": true}');
  });

  it("fails for unknown URL", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) =>
        svc.post("https://unknown.example.com/post", "{}"),
      ),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as HttpError;
      expect(err._tag).toBe("HttpError");
      expect(err.method).toBe("POST");
      expect(err.message).toBe("No mock response");
    }
  });
});

// ── getJson ──

describe("HttpServiceTest — getJson", () => {
  it("parses body as JSON", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) =>
        svc.getJson<{ items: number[]; total: number }>("https://api.example.com/data"),
      ),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toEqual({ items: [1, 2, 3], total: 3 });
  });

  it("fails for unknown URL", async () => {
    const program = pipe(
      Effect.flatMap(HttpService, (svc) => svc.getJson("https://unknown.example.com")),
      Effect.provide(testLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as HttpError;
      expect(err._tag).toBe("HttpError");
      expect(err.method).toBe("GET");
    }
  });

  it("fails when body is not valid JSON", async () => {
    const badJsonLayer = HttpServiceTest({
      "https://api.example.com/bad-json": {
        status: 200,
        headers: {},
        body: "not valid json {{{",
      },
    });

    const program = pipe(
      Effect.flatMap(HttpService, (svc) =>
        svc.getJson("https://api.example.com/bad-json"),
      ),
      Effect.provide(badJsonLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const err = result.left as HttpError;
      expect(err._tag).toBe("HttpError");
      expect(err.message).toContain("JSON parse error");
    }
  });
});

// ── HttpResponse construction ──

describe("HttpResponse construction", () => {
  it("constructs a well-formed response", () => {
    const resp: HttpResponse = {
      status: 200,
      headers: { "content-type": "application/json", "x-custom": "value" },
      body: '{"ok": true}',
    };
    expect(resp.status).toBe(200);
    expect(resp.headers["content-type"]).toBe("application/json");
    expect(resp.body).toBe('{"ok": true}');
  });

  it("constructs a response with empty headers and body", () => {
    const resp: HttpResponse = {
      status: 204,
      headers: {},
      body: "",
    };
    expect(resp.status).toBe(204);
    expect(Object.keys(resp.headers)).toHaveLength(0);
    expect(resp.body).toBe("");
  });
});

// ── HttpError construction ──

describe("HttpError construction", () => {
  it("constructs a well-formed error with all fields", () => {
    const err: HttpError = {
      _tag: "HttpError",
      url: "https://api.example.com/fail",
      method: "GET",
      message: "Connection refused",
      statusCode: 503,
      cause: new Error("ECONNREFUSED"),
    };
    expect(err._tag).toBe("HttpError");
    expect(err.url).toBe("https://api.example.com/fail");
    expect(err.method).toBe("GET");
    expect(err.message).toBe("Connection refused");
    expect(err.statusCode).toBe(503);
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("constructs an error without optional fields", () => {
    const err: HttpError = {
      _tag: "HttpError",
      url: "https://api.example.com",
      method: "POST",
      message: "Timeout",
    };
    expect(err._tag).toBe("HttpError");
    expect(err.statusCode).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});
