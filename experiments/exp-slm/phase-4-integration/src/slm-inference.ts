/**
 * SLM Inference Client — HTTP bridge to the Python ONNX model server.
 *
 * Since onnxruntime-node does not work on this Windows machine (native
 * backend not found), we use an HTTP bridge: Python serves the ONNX model
 * via FastAPI, TypeScript calls it via HTTP.
 *
 * Also provides a mock implementation for testing without a running server.
 */

// ── Interfaces ─────────────────────────────────────────────────

/** Result of a single SLM generation call. */
export interface SLMResult {
  /** The generated DSL text. */
  tokens: string;
  /** Length-normalized sequence log-probability. */
  confidence: number;
  /** Number of input tokens consumed. */
  inputTokenCount: number;
  /** Number of output tokens generated. */
  outputTokenCount: number;
  /** Wall-clock latency of the generation call in ms. */
  latencyMs: number;
}

/** SLM inference client contract. */
export interface SLMInference {
  readonly modelId: string;
  init(): Promise<void>;
  generate(input: string): Promise<SLMResult>;
  dispose(): Promise<void>;
}

// ── HTTP Bridge Implementation ─────────────────────────────────

/** Configuration for the HTTP-based SLM inference client. */
export interface HttpSLMInferenceConfig {
  modelId: string;
  /** Base URL of the Python FastAPI server, e.g. "http://localhost:8100". */
  serverUrl: string;
  /** Request timeout in ms. Default: 5000. */
  timeoutMs?: number;
}

/**
 * Create an SLM inference client that calls a Python HTTP server.
 *
 * The server must expose:
 * - POST /generate  { input, max_length } -> { output, confidence, input_tokens, output_tokens, latency_ms }
 * - GET  /health    -> { status: "ok" }
 */
export function createHttpSLMInference(config: HttpSLMInferenceConfig): SLMInference {
  const { modelId, serverUrl, timeoutMs = 5000 } = config;
  const baseUrl = serverUrl.replace(/\/+$/, '');

  return {
    modelId,

    async init(): Promise<void> {
      // Verify the server is reachable by hitting the health endpoint.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        if (!resp.ok) {
          throw new Error(`Health check failed: HTTP ${resp.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    },

    async generate(input: string): Promise<SLMResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const wallStart = performance.now();

      try {
        const resp = await fetch(`${baseUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, max_length: 256 }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          throw new Error(`SLM server error: HTTP ${resp.status}`);
        }

        const data = (await resp.json()) as {
          output: string;
          confidence: number;
          input_tokens: number;
          output_tokens: number;
          latency_ms: number;
        };

        const wallMs = performance.now() - wallStart;

        return {
          tokens: data.output,
          confidence: data.confidence,
          inputTokenCount: data.input_tokens,
          outputTokenCount: data.output_tokens,
          latencyMs: wallMs,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async dispose(): Promise<void> {
      // No persistent resources to clean up for the HTTP client.
    },
  };
}

// ── Mock Implementation ────────────────────────────────────────

/**
 * Create a mock SLM inference client for testing.
 *
 * Responses are looked up by input string. If the input is not found in
 * the map, a default "garbage output" result is returned (low confidence,
 * unparseable tokens).
 */
export function createMockSLMInference(responses: Map<string, SLMResult>): SLMInference {
  let initialized = false;

  return {
    modelId: 'mock-slm',

    async init(): Promise<void> {
      initialized = true;
    },

    async generate(input: string): Promise<SLMResult> {
      if (!initialized) {
        throw new Error('Mock SLM not initialized — call init() first');
      }
      const result = responses.get(input);
      if (result) {
        return { ...result };
      }
      // Default: garbage output that should trigger fallback
      return {
        tokens: '<<GARBAGE_OUTPUT>>',
        confidence: 0.05,
        inputTokenCount: Math.ceil(input.length / 4),
        outputTokenCount: 5,
        latencyMs: 1,
      };
    },

    async dispose(): Promise<void> {
      initialized = false;
    },
  };
}
