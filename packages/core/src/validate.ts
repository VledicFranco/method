import type { Session } from './state.js';
import type { ValidationFinding, ValidationResult } from './types.js';

export function validateStepOutput(
  session: Session,
  stepId: string,
  output: Record<string, unknown>,
): ValidationResult {
  // 1. Get current step and verify stepId matches
  const current = session.current();
  if (current.step.id !== stepId) {
    throw new Error(
      `step_id mismatch: expected ${current.step.id} but got ${stepId}`,
    );
  }

  const findings: ValidationFinding[] = [];
  const outputSchema = current.step.outputSchema;
  const postcondition = current.step.postcondition;

  // 2. Schema validation (if output_schema is not null)
  if (outputSchema !== null) {
    // Check required_fields if present (structured schema from registry YAML)
    const requiredFields = outputSchema['required_fields'] as
      | Array<Record<string, unknown>>
      | undefined;

    if (Array.isArray(requiredFields)) {
      // Structured schema with required_fields array
      for (const fieldDef of requiredFields) {
        const fieldName = fieldDef['name'] as string;
        if (!(fieldName in output)) {
          findings.push({
            field: fieldName,
            issue: `Missing required field: ${fieldName}`,
            severity: 'error',
          });
          continue;
        }

        // Basic type checking from the field definition
        const expectedType = fieldDef['type'] as string | undefined;
        if (expectedType) {
          checkType(fieldName, output[fieldName], expectedType, findings);
        }
      }
    } else {
      // Simple schema: keys are field names, values describe expected type
      for (const key of Object.keys(outputSchema)) {
        if (key === 'type') continue; // skip top-level schema type descriptor
        if (!(key in output)) {
          findings.push({
            field: key,
            issue: `Missing required field: ${key}`,
            severity: 'error',
          });
          continue;
        }

        const schemaValue = outputSchema[key];
        if (typeof schemaValue === 'string') {
          checkType(key, output[key], schemaValue, findings);
        } else if (
          typeof schemaValue === 'object' &&
          schemaValue !== null &&
          'type' in schemaValue
        ) {
          checkType(
            key,
            output[key],
            (schemaValue as Record<string, unknown>)['type'] as string,
            findings,
          );
        }
        // else: skip type check — just verify field exists (already done above)
      }
    }
  }

  // 3. Postcondition check (if postcondition is not null)
  let postconditionMet = true;
  if (postcondition !== null) {
    // Heuristic: extract key noun phrases (words > 3 chars, lowercase)
    const keywords = postcondition
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
      .filter((w) => w.length > 3);

    if (keywords.length > 0) {
      const outputStr = JSON.stringify(output).toLowerCase();
      const matched = keywords.filter((kw) => outputStr.includes(kw));
      postconditionMet = matched.length >= keywords.length * 0.5;
    }
  }

  // 4. Always record the output
  session.recordStepOutput(stepId, output);

  // 5. Recommendation logic
  const hasErrors = findings.some((f) => f.severity === 'error');
  let recommendation: 'advance' | 'retry' | 'escalate';
  if (hasErrors) {
    recommendation = 'retry';
  } else if (!postconditionMet) {
    recommendation = 'escalate';
  } else {
    recommendation = 'advance';
  }

  return {
    valid: !hasErrors && postconditionMet,
    findings,
    postconditionMet,
    recommendation,
  };
}

function checkType(
  fieldName: string,
  value: unknown,
  expectedType: string,
  findings: ValidationFinding[],
): void {
  const normalizedType = expectedType.toLowerCase();

  switch (normalizedType) {
    case 'string':
      if (typeof value !== 'string') {
        findings.push({
          field: fieldName,
          issue: `Expected string but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        findings.push({
          field: fieldName,
          issue: `Expected number but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        findings.push({
          field: fieldName,
          issue: `Expected boolean but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        findings.push({
          field: fieldName,
          issue: `Expected array but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        findings.push({
          field: fieldName,
          issue: `Expected object but got ${Array.isArray(value) ? 'array' : typeof value}`,
          severity: 'error',
        });
      }
      break;
    case 'enum':
      // Enum types can't be validated without the values list — just check field exists
      break;
    default:
      // Unknown type — skip type check, field existence already verified
      break;
  }
}
