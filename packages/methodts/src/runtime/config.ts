/**
 * Runtime configuration type.
 *
 * Controls event bus sizing, retry policy, and default suspension behavior.
 *
 * @see PRD 021 §12.1 — RuntimeConfig
 */

/** Runtime configuration. */
export type RuntimeConfig = {
  readonly eventBusCapacity: number;
  readonly maxRetries: number;
  readonly suspensionDefault: "never" | "on_failure" | "always";
};

/** Sensible defaults for runtime configuration. */
export const defaultRuntimeConfig: RuntimeConfig = {
  eventBusCapacity: 1000,
  maxRetries: 3,
  suspensionDefault: "on_failure",
};
