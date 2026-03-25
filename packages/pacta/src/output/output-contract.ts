/**
 * Output Contract — structural validation of agent results.
 *
 * When a schema is provided, the runtime validates the agent's output
 * against it. On failure, the retry policy determines whether the
 * agent is re-prompted with validation feedback.
 *
 * The schema type is left generic — Pacta ships with Zod support but
 * the validation layer is pluggable via the SchemaValidator port.
 */

export interface OutputContract<T = string> {
  /** Schema that the output must conform to */
  schema?: SchemaDefinition<T>;

  /** Re-prompt the agent on validation failure (default: false) */
  retryOnValidationFailure?: boolean;

  /** Maximum retry attempts before giving up (default: 2) */
  maxRetries?: number;

  /** Feedback template sent to agent on validation failure.
   *  Use {error} placeholder for the validation error message. */
  retryPrompt?: string;
}

/**
 * Schema definition — abstract over the validation library.
 *
 * The caller provides a parse function that returns either
 * a typed result or validation errors. This keeps Pacta
 * decoupled from Zod, Ajv, or any specific validator.
 */
export interface SchemaDefinition<T> {
  /** Attempt to parse/validate the raw output string */
  parse(raw: string): SchemaResult<T>;

  /** Human-readable description of the expected shape (for retry prompts) */
  description?: string;
}

export type SchemaResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };
