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

export function reloadMethodologies(map: Map<string, Methodology>): {
  loaded: string[];
  errors: Array<{ file: string; message: string }>;
} {
  const files = readdirSync(METHODOLOGIES_DIR).filter((f) => f.endsWith('.yaml'));
  const loaded: string[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  const next = new Map<string, Methodology>();

  for (const file of files) {
    try {
      const raw = readFileSync(join(METHODOLOGIES_DIR, file), 'utf-8');
      const parsed = parse(raw) as unknown;
      const result = MethodologySchema.safeParse(parsed);
      if (!result.success) {
        errors.push({ file, message: result.error.message });
        continue;
      }
      next.set(result.data.name, result.data);
      loaded.push(result.data.name);
    } catch (err) {
      errors.push({ file, message: err instanceof Error ? err.message : String(err) });
    }
  }

  map.clear();
  for (const [key, value] of next) {
    map.set(key, value);
  }

  return { loaded, errors };
}
