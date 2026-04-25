// SPDX-License-Identifier: Apache-2.0
/**
 * SLM error hierarchy — PRD 057.
 */

/** Base class for all SLM-related failures. */
export class SLMError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** Raised when the SLM runtime's transport / framework is not installed or reachable. */
export class SLMNotAvailable extends SLMError {}

/** Raised when the SLM runtime can be reached but fails to load a model. */
export class SLMLoadError extends SLMError {}

/** Raised when an inference call fails (network, timeout, server error, malformed response). */
export class SLMInferenceError extends SLMError {}
