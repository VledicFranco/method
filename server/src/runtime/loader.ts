import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { MethodologySchema, type Methodology } from '../schema.js';
import { db } from '../db/index.js';
import { methodologies as methodologiesTable } from '../db/schema.js';
import { notInArray } from 'drizzle-orm';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const METHODOLOGIES_DIR = join(__dirname, '..', 'methodologies');

export async function upsertMethodology(m: Methodology): Promise<void> {
  await db
    .insert(methodologiesTable)
    .values({
      name: m.name,
      description: m.description,
      version: m.version,
      phases: m.phases,
    })
    .onConflictDoUpdate({
      target: methodologiesTable.name,
      set: {
        description: m.description,
        version: m.version,
        phases: m.phases,
        updated_at: new Date(),
      },
    });
}

export async function loadMethodologies(): Promise<Map<string, Methodology>> {
  const files = readdirSync(METHODOLOGIES_DIR).filter((f) => f.endsWith('.yaml'));

  if (files.length === 0) {
    throw new Error(`No methodology YAML files found in ${METHODOLOGIES_DIR}`);
  }

  const map = new Map<string, Methodology>();

  for (const file of files) {
    const raw = readFileSync(join(METHODOLOGIES_DIR, file), 'utf-8');
    const parsed = parse(raw) as unknown;
    const result = MethodologySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`Invalid methodology file "${file}":\n${result.error.message}`);
    }

    await upsertMethodology(result.data);
    map.set(result.data.name, result.data);
  }

  // Load any DB-only methodologies (imported at runtime, not on disk)
  const fileNames = Array.from(map.keys());
  const dbOnly = fileNames.length > 0
    ? await db.select().from(methodologiesTable).where(notInArray(methodologiesTable.name, fileNames))
    : await db.select().from(methodologiesTable);

  for (const row of dbOnly) {
    const result = MethodologySchema.safeParse({
      name: row.name,
      description: row.description,
      version: row.version,
      phases: row.phases,
    });
    if (result.success) {
      map.set(result.data.name, result.data);
    }
  }

  return map;
}

export async function reloadMethodologies(map: Map<string, Methodology>): Promise<{
  loaded: string[];
  errors: Array<{ file: string; message: string }>;
}> {
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
      await upsertMethodology(result.data);
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
