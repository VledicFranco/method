// SPDX-License-Identifier: Apache-2.0
/**
 * SLMInferer Port — PRD 057 Surface 3.
 *
 * Anything that can run SLM inference. Structurally implemented by
 * HttpBridgeSLMRuntime, SpilloverSLMRuntime, and any future local ONNX
 * runtime. Pure port — zero implementation imports. Asserted by the
 * G-SLM-INFERER architecture gate.
 */

import type { SLMInferenceResult, SLMInferOptions } from '../cognitive/slm/types.js';

export interface SLMInferer {
  /**
   * Run a single inference. Implementations should be fast, deterministic
   * given identical inputs, and report calibrated confidence.
   */
  infer(prompt: string, options?: SLMInferOptions): Promise<SLMInferenceResult>;
}
