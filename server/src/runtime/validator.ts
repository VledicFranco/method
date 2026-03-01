import type { Phase } from '../schema.js';

export type FailedInvariant = {
  id: string;
  description: string;
};

export type ValidationResult = {
  passed: boolean;
  failed_hard: FailedInvariant[];
  failed_soft: FailedInvariant[];
};

type FieldViolation = {
  field: string;
  reason: string;
};

function checkField(
  fieldName: string,
  fieldSchema: Phase['output_schema'][string],
  value: unknown,
): FieldViolation | null {
  if (value === undefined || value === null) {
    return { field: fieldName, reason: `"${fieldName}" was not provided` };
  }

  switch (fieldSchema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return { field: fieldName, reason: `"${fieldName}" must be a string` };
      }
      const minLen = fieldSchema.min_length ?? 1;
      if (value.length < minLen) {
        return { field: fieldName, reason: `"${fieldName}" must not be empty` };
      }
      break;
    }

    case 'array': {
      if (!Array.isArray(value)) {
        return { field: fieldName, reason: `"${fieldName}" must be an array` };
      }
      if (fieldSchema.min_items !== undefined && value.length < fieldSchema.min_items) {
        return {
          field: fieldName,
          reason: `"${fieldName}" must have at least ${fieldSchema.min_items} item(s), got ${value.length}`,
        };
      }
      if (fieldSchema.max_items !== undefined && value.length > fieldSchema.max_items) {
        return {
          field: fieldName,
          reason: `"${fieldName}" must have at most ${fieldSchema.max_items} item(s), got ${value.length}`,
        };
      }
      break;
    }

    case 'number': {
      if (typeof value !== 'number') {
        return { field: fieldName, reason: `"${fieldName}" must be a number` };
      }
      if (fieldSchema.min_value !== undefined && value < fieldSchema.min_value) {
        return {
          field: fieldName,
          reason: `"${fieldName}" must be >= ${fieldSchema.min_value}`,
        };
      }
      if (fieldSchema.max_value !== undefined && value > fieldSchema.max_value) {
        return {
          field: fieldName,
          reason: `"${fieldName}" must be <= ${fieldSchema.max_value}`,
        };
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        return { field: fieldName, reason: `"${fieldName}" must be a boolean` };
      }
      break;
    }
  }

  // Enum check (applies to any type — checked as string representation)
  if (fieldSchema.enum !== undefined) {
    const strValue = String(value);
    if (!fieldSchema.enum.includes(strValue)) {
      return {
        field: fieldName,
        reason: `"${fieldName}" must be one of: ${fieldSchema.enum.join(', ')}`,
      };
    }
  }

  return null;
}

function mapToInvariant(
  phase: Phase,
  violation: FieldViolation,
): FailedInvariant & { hard: boolean } {
  // Match invariant by ID prefix: invariant IDs follow the convention {field_name}_{constraint}
  const match = phase.invariants.find((inv) => inv.id.startsWith(violation.field));

  if (match) {
    return { id: match.id, description: violation.reason, hard: match.hard };
  }

  // No matching invariant — default to hard
  return {
    id: `${violation.field}_required`,
    description: violation.reason,
    hard: true,
  };
}

export function validateOutput(
  phase: Phase,
  output: Record<string, unknown>,
): ValidationResult {
  const violations: FieldViolation[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(phase.output_schema)) {
    const violation = checkField(fieldName, fieldSchema, output[fieldName]);
    if (violation) violations.push(violation);
  }

  const failed_hard: FailedInvariant[] = [];
  const failed_soft: FailedInvariant[] = [];

  for (const violation of violations) {
    const { hard, ...entry } = mapToInvariant(phase, violation);
    if (hard) {
      failed_hard.push(entry);
    } else {
      failed_soft.push(entry);
    }
  }

  return {
    passed: failed_hard.length === 0,
    failed_hard,
    failed_soft,
  };
}
