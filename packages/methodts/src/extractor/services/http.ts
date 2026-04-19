// SPDX-License-Identifier: Apache-2.0
/**
 * HttpService — Effect Layer for HTTP operations.
 *
 * Provides a testable abstraction over HTTP fetch (GET, POST, JSON parsing).
 * Live implementation uses the global fetch API; the test layer supports
 * canned responses for deterministic testing.
 *
 * PRD Component 8: Extractor framework — service layer.
 * DR-T02: Effect is the primary side-effect mechanism.
 */

import { Context, Effect, Layer } from "effect";

/**
 * Error produced when an HTTP operation fails.
 *
 * Captures the URL, HTTP method, a human-readable message,
 * and optionally the status code and underlying cause.
 */
export type HttpError = {
  readonly _tag: "HttpError";
  readonly url: string;
  readonly method: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
};

/**
 * Structured HTTP response.
 *
 * Contains the status code, response headers, and the body as a string.
 */
export type HttpResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/**
 * Service interface for HTTP operations.
 *
 * All HTTP interaction in the extractor framework goes through this service,
 * enabling both live execution and deterministic test mocks.
 */
export interface HttpService {
  /** Perform an HTTP GET request. */
  readonly get: (
    url: string,
    headers?: Record<string, string>,
  ) => Effect.Effect<HttpResponse, HttpError, never>;
  /** Perform an HTTP POST request with a string body. */
  readonly post: (
    url: string,
    body: string,
    headers?: Record<string, string>,
  ) => Effect.Effect<HttpResponse, HttpError, never>;
  /** Perform an HTTP GET and parse the response body as JSON. */
  readonly getJson: <T>(
    url: string,
    headers?: Record<string, string>,
  ) => Effect.Effect<T, HttpError, never>;
}

/**
 * Effect Context tag for HttpService.
 *
 * Used in Layer composition to provide/require HttpService.
 */
export const HttpService = Context.GenericTag<HttpService>("HttpService");

/**
 * Live implementation of HttpService using the global fetch API.
 */
export const HttpServiceLive = Layer.succeed(HttpService, {
  get: (url, headers) =>
    Effect.tryPromise({
      try: async () => {
        const resp = await fetch(url, { headers });
        const body = await resp.text();
        return {
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          body,
        };
      },
      catch: (e) => ({
        _tag: "HttpError" as const,
        url,
        method: "GET",
        message: String(e),
        cause: e,
      }),
    }),

  post: (url, body, headers) =>
    Effect.tryPromise({
      try: async () => {
        const resp = await fetch(url, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json", ...headers },
        });
        const respBody = await resp.text();
        return {
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          body: respBody,
        };
      },
      catch: (e) => ({
        _tag: "HttpError" as const,
        url,
        method: "POST",
        message: String(e),
        cause: e,
      }),
    }),

  getJson: (url, headers) =>
    Effect.tryPromise({
      try: async () => {
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      },
      catch: (e) => ({
        _tag: "HttpError" as const,
        url,
        method: "GET",
        message: String(e),
        cause: e,
      }),
    }),
});

/**
 * Test implementation of HttpService with canned responses.
 *
 * Provides deterministic behavior for testing: responses are stored as a
 * Record<string, HttpResponse> mapping from URL to response.
 *
 * @param responses - Map from URL to expected HttpResponse
 * @returns A Layer providing HttpService with mock behavior
 */
export const HttpServiceTest = (responses: Record<string, HttpResponse>) =>
  Layer.succeed(HttpService, {
    get: (url) => {
      const resp = responses[url];
      if (resp) return Effect.succeed(resp);
      return Effect.fail({
        _tag: "HttpError" as const,
        url,
        method: "GET",
        message: "No mock response",
      });
    },

    post: (url) => {
      const resp = responses[url];
      if (resp) return Effect.succeed(resp);
      return Effect.fail({
        _tag: "HttpError" as const,
        url,
        method: "POST",
        message: "No mock response",
      });
    },

    getJson: <T>(url: string) => {
      const resp = responses[url];
      if (resp) {
        return Effect.try({
          try: () => JSON.parse(resp.body) as T,
          catch: (e) => ({
            _tag: "HttpError" as const,
            url,
            method: "GET",
            message: `JSON parse error: ${String(e)}`,
            cause: e,
          }),
        });
      }
      return Effect.fail({
        _tag: "HttpError" as const,
        url,
        method: "GET",
        message: "No mock response",
      }) as Effect.Effect<T, HttpError, never>;
    },
  });
