/**
 * Infrastructure-level faults for the conformance runner. Check failures are
 * recorded as fields on {@link ComplianceReport}; these errors are thrown only
 * when the run cannot proceed (missing peer dep, invalid fixture, plugin
 * crash, I/O failure).
 *
 * S8 §5.1 freezes the code set: `MISSING_APP | INVALID_FIXTURE | PLUGIN_CRASH | IO_ERROR`.
 */

export type ConformanceRunErrorCode =
  | 'MISSING_APP'
  | 'INVALID_FIXTURE'
  | 'PLUGIN_CRASH'
  | 'IO_ERROR';

export interface ConformanceRunErrorOptions {
  readonly detail?: string;
  readonly cause?: unknown;
}

export class ConformanceRunError extends Error {
  readonly code: ConformanceRunErrorCode;
  readonly detail?: string;
  override readonly cause?: unknown;

  constructor(code: ConformanceRunErrorCode, options?: ConformanceRunErrorOptions) {
    const message = options?.detail
      ? `[${code}] ${options.detail}`
      : `[${code}] conformance run failed`;
    super(message);
    this.name = 'ConformanceRunError';
    this.code = code;
    if (options?.detail !== undefined) this.detail = options.detail;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
