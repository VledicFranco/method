import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { MethodologySchema, type Methodology } from '../schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METHODOLOGIES_DIR = join(__dirname, '..', 'methodologies');

export function loadMethodologies(): Map<string, Methodology> {
  const files = readdirSync(METHODOLOGIES_DIR).filter((f) => f.endsWith('.yaml'));

  if (files.length === 0) {
    throw new Error(`No methodology YAML files found in ${METHODOLOGIES_DIR}`);
  }

  const methodologies = new Map<string, Methodology>();

  for (const file of files) {
    const raw = readFileSync(join(METHODOLOGIES_DIR, file), 'utf-8');
    const parsed = parse(raw) as unknown;
    const result = MethodologySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`Invalid methodology file "${file}":\n${result.error.message}`);
    }

    methodologies.set(result.data.name, result.data);
  }

  return methodologies;
}
