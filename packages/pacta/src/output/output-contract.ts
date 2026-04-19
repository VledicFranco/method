// SPDX-License-Identifier: Apache-2.0
/**
 * Output Contract — structural validation of agent results.
 *
 * The schema's parse function accepts `unknown` to accommodate both
 * string output (CLI agents) and structured JSON (API agents).
 */

export interface OutputContract<T = unknown> {
  schema?: SchemaDefinition<T>;
  retryOnValidationFailure?: boolean;
  maxRetries?: number;
  retryPrompt?: string;
}

export interface SchemaDefinition<T> {
  /** Accepts string (CLI output) or structured object (API response) */
  parse(raw: unknown): SchemaResult<T>;
  description?: string;
}

export type SchemaResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };
