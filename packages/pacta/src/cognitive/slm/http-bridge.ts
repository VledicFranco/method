// SPDX-License-Identifier: Apache-2.0
/**
 * HttpBridgeSLMRuntime — calls a remote serve-slm.py over HTTP.
 *
 * Implements the SLMInferer port. Wraps the bridge's `/health` and
 * `/generate` endpoints (the same contract as kpi-checker-slm and
 * router-slm). Used when the model is too large to load in-process or
 * lives on a different machine (typical: chobits over Tailscale).
 *
 * Uses node:fetch (built-in to Node 18+). No third-party HTTP client —
 * pacta's G-PORT gate forbids non-monorepo runtime deps.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md (Wave 1)
 */

import type { SLMInferer } from '../../ports/slm-inferer.js';
import type { SLMInferenceResult, SLMInferOptions } from './types.js';
import { SLMInferenceError, SLMLoadError, SLMNotAvailable } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LENGTH = 256;

export interface HttpBridgeSLMRuntimeOptions {
  /** Base URL of the serve-slm bridge (e.g. `http://chobits:8100`). */
  readonly baseUrl: string;
  /** Default timeout for /generate calls. Per-call options override. */
  readonly timeoutMs?: number;
  /** Default generation length. Per-call options override. */
  readonly maxLength?: number;
}

export class HttpBridgeSLMRuntime implements SLMInferer {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxLength: number;
  private loaded = false;

  constructor(options: HttpBridgeSLMRuntimeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  }

  /**
   * Ping `/health`. Throws if the bridge is unreachable or reports no
   * model loaded. Subsequent `infer()` calls require this to have
   * succeeded; without it the runtime starts in a fail-fast posture.
   *
   * Idempotent — repeated load() calls are no-ops once loaded.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
      });
    } catch (e) {
      throw new SLMNotAvailable(
        `SLM bridge at ${this.baseUrl} unreachable: ${(e as Error).message}`,
        { cause: e },
      );
    }
    if (!response.ok) {
      throw new SLMNotAvailable(
        `SLM bridge at ${this.baseUrl} returned HTTP ${response.status}`,
      );
    }
    let body: { model_loaded?: boolean; status?: unknown; model_path?: unknown };
    try {
      body = (await response.json()) as typeof body;
    } catch (e) {
      throw new SLMLoadError(
        `SLM bridge at ${this.baseUrl} /health returned invalid JSON`,
        { cause: e },
      );
    }
    if (!body.model_loaded) {
      throw new SLMLoadError(
        `SLM bridge at ${this.baseUrl} reports no model loaded ` +
          `(status=${JSON.stringify(body.status)}, path=${JSON.stringify(body.model_path)})`,
      );
    }
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async infer(prompt: string, options?: SLMInferOptions): Promise<SLMInferenceResult> {
    if (!this.loaded) {
      throw new SLMInferenceError(
        'HttpBridgeSLMRuntime.infer() called before load(); call load() first',
      );
    }
    const start = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const maxLength = options?.maxLength ?? this.defaultMaxLength;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: prompt, max_length: maxLength }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new SLMInferenceError(
        `HTTP bridge /generate failed: ${(e as Error).message}`,
        { cause: e },
      );
    }
    if (!response.ok) {
      throw new SLMInferenceError(
        `HTTP bridge /generate returned HTTP ${response.status}`,
      );
    }
    let body: {
      output?: unknown;
      confidence?: unknown;
      latency_ms?: unknown;
    };
    try {
      body = (await response.json()) as typeof body;
    } catch (e) {
      throw new SLMInferenceError('HTTP bridge /generate returned invalid JSON', { cause: e });
    }
    const wallMs = Date.now() - start;
    // Prefer server-reported latency (excludes RTT) when present.
    const latencyMs = typeof body.latency_ms === 'number' ? body.latency_ms : wallMs;
    return {
      output: typeof body.output === 'string' ? body.output : '',
      confidence: typeof body.confidence === 'number' ? body.confidence : 0,
      inferenceMs: latencyMs,
      escalated: false,
      fallbackReason: undefined,
    };
  }
}
