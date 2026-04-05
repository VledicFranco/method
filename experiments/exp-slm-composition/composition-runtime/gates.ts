/**
 * Gate implementations — PeggyCompileGate, PeggyParseGate, SchemaGate.
 *
 * Validation gates are the key innovation of CLM composition. They bound
 * error propagation between stages. See RFC 005 Part VI.
 */

import peggy from 'peggy';
import type { GatePort, GateInput, GateResult, PipelineContext } from './types.js';

// ── Peggy Compile Gate (deterministic, free) ─────────────────

/**
 * Attempts to compile the stage output as a Peggy grammar.
 * On pass, stores the compiled parser in stateUpdates under the given key.
 */
export function createPeggyCompileGate(
  id: string = 'peggy-compile',
  stateKey: string = 'compiledParser',
): GatePort {
  return {
    id,
    async validate(input: GateInput): Promise<GateResult> {
      try {
        const parser = peggy.generate(input.data);
        return {
          pass: true,
          validatedData: input.data,
          stateUpdates: new Map([[stateKey, parser]]),
        };
      } catch (e) {
        const error = e as Error;
        return {
          pass: false,
          reason: `Grammar compilation failed: ${error.message?.slice(0, 300)}`,
        };
      }
    },
  };
}

// ── Peggy Parse Gate (deterministic, free) ────────────────────

/**
 * Parses the stage output through a pre-compiled Peggy parser.
 * The parser is retrieved from pipeline state using getParser callback.
 * On pass, stores the parsed AST in validatedData.
 */
export function createPeggyParseGate(
  id: string,
  getParser: (context: PipelineContext) => peggy.Parser,
): GatePort {
  return {
    id,
    async validate(input: GateInput): Promise<GateResult> {
      let parser: peggy.Parser;
      try {
        parser = getParser(input.context);
        if (!parser) {
          return {
            pass: false,
            reason: 'Could not retrieve parser: parser is null or undefined',
          };
        }
      } catch (e) {
        const error = e as Error;
        return {
          pass: false,
          reason: `Could not retrieve parser: ${error.message}`,
        };
      }

      try {
        const ast = parser.parse(input.data);
        return { pass: true, validatedData: ast };
      } catch (e) {
        const error = e as Error;
        return {
          pass: false,
          reason: `Parse failed: ${error.message?.slice(0, 300)}`,
        };
      }
    },
  };
}

// ── Schema Gate (deterministic, free) ─────────────────────────

/**
 * Validates that a parsed object has the expected fields with the
 * expected types. Used after a parse gate to check structural shape.
 *
 * @param schema Map of fieldName → expected typeof string ('string', 'number', 'boolean', 'object')
 */
export function createSchemaGate(
  id: string,
  schema: Record<string, string | string[]>,
): GatePort {
  return {
    id,
    async validate(input: GateInput): Promise<GateResult> {
      let parsed: Record<string, unknown>;
      try {
        parsed = typeof input.data === 'string'
          ? JSON.parse(input.data) as Record<string, unknown>
          : input.data as unknown as Record<string, unknown>;
      } catch {
        return { pass: false, reason: 'Input is not valid JSON' };
      }

      const errors: string[] = [];
      for (const [field, expectedTypes] of Object.entries(schema)) {
        const value = parsed[field];
        const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];

        if (value === undefined) {
          // Only fail if field is required (not in optional list)
          if (!types.includes('undefined')) {
            errors.push(`Missing required field: ${field}`);
          }
          continue;
        }

        const actualType = value === null ? 'null' : typeof value;
        if (!types.includes(actualType)) {
          errors.push(`Field ${field}: expected ${types.join('|')}, got ${actualType}`);
        }
      }

      if (errors.length > 0) {
        return { pass: false, reason: errors.join('; ') };
      }
      return { pass: true, validatedData: parsed };
    },
  };
}
