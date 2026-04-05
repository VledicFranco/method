/**
 * Stage implementations — SLM stage, deterministic stage, example generator.
 */

import type {
  StagePort,
  StageInput,
  StageOutput,
  InferencePort,
  PipelineContext,
} from './types.js';

// ── SLM Stage ────────────────────────────────────────────────

/**
 * Wraps an InferencePort into a StagePort. Optionally transforms the
 * raw input through a prompt template before sending to the model.
 */
export function createSLMStage(
  id: string,
  inference: InferencePort,
  promptTemplate?: (input: string) => string,
): StagePort {
  return {
    id,
    type: 'slm',
    async execute(input: StageInput): Promise<StageOutput> {
      const prompt = promptTemplate ? promptTemplate(input.data) : input.data;
      const result = await inference.generate(prompt);
      return {
        data: result.output,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
      };
    },
  };
}

// ── Deterministic Stage ──────────────────────────────────────

/**
 * Wraps a pure function into a StagePort. Confidence is always 1.0.
 */
export function createDeterministicStage(
  id: string,
  transform: (input: string, context: PipelineContext) => string,
): StagePort {
  return {
    id,
    type: 'deterministic',
    async execute(input: StageInput): Promise<StageOutput> {
      const start = performance.now();
      const result = transform(input.data, input.context);
      const latencyMs = performance.now() - start;
      return { data: result, confidence: 1.0, latencyMs };
    },
  };
}

// ── Example Generator Stage ──────────────────────────────────

/**
 * Generates a sample DSL string that should parse through a B-1 grammar.
 *
 * B-1 grammars follow a consistent pattern:
 *   - UPPER_SNAKE sections with typed values (QuotedString, Float, Bool, enums)
 *   - Required sections come first, optional sections (Opt suffix) after
 *   - Primitives: QuotedString → "value", Float → 42.0, Bool → yes/no, Integer → 42
 *
 * Extracts section structure from the grammar text and generates random values.
 */
export function createExampleGeneratorStage(id: string): StagePort {
  return {
    id,
    type: 'deterministic',
    async execute(input: StageInput): Promise<StageOutput> {
      const start = performance.now();
      const grammar = input.data;
      const example = generateExampleFromGrammar(grammar);
      const latencyMs = performance.now() - start;
      return { data: example, confidence: 1.0, latencyMs };
    },
  };
}

/**
 * Extract section order from the top-level rule, then look up each section's
 * value type from its definition. Generates only required sections (skips Opt)
 * in the correct order.
 *
 * B-1 grammars follow a consistent pattern:
 *   TopRule = field1:Section1 EOL field2:Section2 ... optField:OptSection ...
 * where required sections use explicit EOL separators and Opt sections handle
 * their own leading EOL internally.
 */
export function generateExampleFromGrammar(grammar: string): string {
  // Step 1: Extract ordered field references from the top-level rule.
  // The top-level rule is everything before the first section definition.
  // Field refs look like: fieldName:SectionName
  const topRuleMatch = grammar.match(
    /^\w+\s*\n\s*=\s*(.+?)(?:\n\s*\{ return)/s,
  );
  if (!topRuleMatch) {
    return fallbackGenerate(grammar);
  }

  const topBody = topRuleMatch[1];
  // Extract label:RuleName pairs in order
  const fieldRefs: Array<{ name: string; rule: string }> = [];
  const refRegex = /\w+:(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(topBody)) !== null) {
    const ruleName = match[1];
    // Skip non-section refs (EOL, EOLopt, etc.)
    if (ruleName === 'EOL' || ruleName === 'EOLopt') continue;
    fieldRefs.push({ name: ruleName, rule: ruleName });
  }

  // Step 2: For each referenced section rule, determine the label and value type.
  const lines: string[] = [];

  for (const ref of fieldRefs) {
    // Skip optional sections — they handle their own EOL and can be absent
    if (ref.rule.endsWith('Opt')) continue;

    // Find the section definition in the grammar
    const sectionDefRegex = new RegExp(
      `^${escapeRegex(ref.rule)}\\s*\\n\\s*=\\s*(.+?)(?=\\n\\n|\\n\\w+\\s*\\n|$)`,
      'ms',
    );
    const sectionMatch = grammar.match(sectionDefRegex);
    if (!sectionMatch) continue;

    const sectionBody = sectionMatch[1];

    // Extract label: "LABEL:" pattern
    const labelMatch = sectionBody.match(/"([A-Z][A-Z0-9_]+):"/);
    if (!labelMatch) continue;
    const label = labelMatch[1];

    // Determine value type
    const line = generateLineForSection(label, sectionBody);
    if (line) lines.push(line);
  }

  if (lines.length === 0) {
    return fallbackGenerate(grammar);
  }

  // B-1 grammars use EOL between sections and EOLopt at end.
  // Some grammars have a required EOL after the last required section
  // before optional sections. A trailing newline ensures this parses.
  return lines.join('\n') + '\n';
}

function generateLineForSection(label: string, sectionBody: string): string | null {
  // Check for array/list with "none" alternative:
  //   "LABEL:" _ "none" { return []; }
  //   / "LABEL:" _ first:Type rest:("," _ id:Type)* { return [first, ...rest]; }
  if (sectionBody.includes('return [];') || sectionBody.includes('...rest')) {
    // Array section — check if enum or identifier list
    const enumListMatch = sectionBody.match(/first:\(([^)]+)\)/);
    if (enumListMatch) {
      const firstVal = enumListMatch[1].match(/"([^"]+)"/);
      return firstVal ? `${label}: ${firstVal[1]}` : `${label}: sample`;
    }
    // Identifier list — generate a single identifier
    if (sectionBody.includes('first:Identifier') || sectionBody.includes('first:QuotedString')) {
      return `${label}: sample`;
    }
    // Has "none" option — use it for safety
    if (sectionBody.includes('"none"')) {
      return `${label}: none`;
    }
    return `${label}: sample`;
  }

  // Check for enum alternatives: v:("value1" / "value2" / ...)
  const enumMatch = sectionBody.match(/v:\(([^)]+)\)/);
  if (enumMatch) {
    const firstVal = enumMatch[1].match(/"([^"]+)"/);
    return firstVal ? `${label}: ${firstVal[1]}` : `${label}: unknown`;
  }

  // Check for nullable: "none" { return null; } / QuotedString
  if (sectionBody.includes('"none"') && sectionBody.includes('return null')) {
    return `${label}: "sample-value"`;
  }

  // Check value type: v:TypeName
  const typeMatch = sectionBody.match(/v:(\w+)/);
  if (!typeMatch) return `${label}: "default"`;

  switch (typeMatch[1]) {
    case 'QuotedString': return `${label}: "sample-value"`;
    case 'Float': return `${label}: 42.0`;
    case 'Integer': return `${label}: 42`;
    case 'Bool': return `${label}: yes`;
    case 'Identifier': return `${label}: sample`;
    default: return `${label}: "default"`;
  }
}

/**
 * Fallback: scan for all section labels in definition order.
 * Less accurate but works when top-level rule parsing fails.
 */
function fallbackGenerate(grammar: string): string {
  const lines: string[] = [];
  const sectionRegex = /"([A-Z][A-Z0-9_]+):" _ (?:v:(?:(\w+)|(\([^)]+\))))/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = sectionRegex.exec(grammar)) !== null) {
    const label = match[1];
    if (seen.has(label)) continue;
    seen.add(label);
    const typeName = match[2];
    const enumGroup = match[3];

    if (enumGroup) {
      const em = enumGroup.match(/"([^"]+)"/);
      lines.push(`${label}: ${em ? em[1] : 'unknown'}`);
    } else if (typeName === 'QuotedString') {
      lines.push(`${label}: "sample-value"`);
    } else if (typeName === 'Float') {
      lines.push(`${label}: 42.0`);
    } else if (typeName === 'Integer') {
      lines.push(`${label}: 42`);
    } else if (typeName === 'Bool') {
      lines.push(`${label}: yes`);
    } else {
      lines.push(`${label}: "default"`);
    }
  }

  return lines.join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
