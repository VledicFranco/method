/**
 * Sample output schema for the incident-triage pact.
 *
 * This sample intentionally keeps the schema to a few fields — enough to
 * exercise the output validator without pulling zod as a dep. In production,
 * tenant apps typically use zod or @sinclair/typebox.
 */

export interface TriageOutput {
  /** Severity label — one of the three enum values below. */
  readonly severity: 'critical' | 'warning' | 'info';
  /** One-line human-readable summary for Slack. */
  readonly summary: string;
  /** Suggested next action. */
  readonly nextAction: string;
}

export interface SchemaParseOk<T> {
  readonly success: true;
  readonly data: T;
}

export interface SchemaParseErr {
  readonly success: false;
  errors: string[];
}

export type SchemaParseResult<T> = SchemaParseOk<T> | SchemaParseErr;

/**
 * Lightweight parser matching pacta's `SchemaDefinition.parse` contract.
 * Accepts JSON strings (LLM output) or already-parsed objects.
 */
export const triageSchema = {
  parse(raw: unknown): SchemaParseResult<TriageOutput> {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return { success: false, errors: ['output is not valid JSON'] };
      }
    }
    if (!value || typeof value !== 'object') {
      return { success: false, errors: ['output is not an object'] };
    }
    const obj = value as Record<string, unknown>;
    const errors: string[] = [];
    if (!['critical', 'warning', 'info'].includes(String(obj.severity))) {
      errors.push("severity must be 'critical' | 'warning' | 'info'");
    }
    if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
      errors.push('summary must be a non-empty string');
    }
    if (typeof obj.nextAction !== 'string' || obj.nextAction.length === 0) {
      errors.push('nextAction must be a non-empty string');
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }
    return { success: true, data: obj as unknown as TriageOutput };
  },
};
