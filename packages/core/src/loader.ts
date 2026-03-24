import * as nodeFs from 'fs';
import { join, basename } from 'path';
import yaml from 'js-yaml';
import type { Step, LoadedMethod, MethodEntry, MethodologyEntry, CoreFileSystem } from './types.js';

const defaultFs: CoreFileSystem = {
  readFileSync: nodeFs.readFileSync as CoreFileSystem['readFileSync'],
  readdirSync: nodeFs.readdirSync as CoreFileSystem['readdirSync'],
  existsSync: nodeFs.existsSync,
};

function readYaml(filePath: string, fs: CoreFileSystem): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Failed to parse ${filePath}: YAML did not produce an object`);
  }
  return parsed as Record<string, unknown>;
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string') return val.trim();
  }
  return null;
}

function extractPhases(parsed: Record<string, unknown>, filePath: string): Step[] {
  // phases: is always top-level in current registry; check method.phases as fallback
  let rawPhases = parsed['phases'] as unknown[] | undefined;
  if (!rawPhases) {
    const method = parsed['method'] as Record<string, unknown> | undefined;
    rawPhases = method?.['phases'] as unknown[] | undefined;
  }
  if (!rawPhases) {
    throw new Error(
      `YAML at ${filePath} has no phases — this is a methodology, not a method. Load a specific method instead.`
    );
  }
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    throw new Error(`Method at ${filePath} has no steps defined`);
  }

  return rawPhases.map((phase) => {
    const p = phase as Record<string, unknown>;
    const id = p['id'];
    const name = p['name'];
    if (typeof id !== 'string') throw new Error(`Phase missing required 'id' field in ${filePath}`);
    if (typeof name !== 'string') throw new Error(`Phase missing required 'name' field in ${filePath}`);

    return {
      id,
      name,
      role: typeof p['role'] === 'string' ? p['role'] : null,
      precondition: typeof p['precondition'] === 'string' ? p['precondition'].trim() : null,
      postcondition: typeof p['postcondition'] === 'string' ? p['postcondition'].trim() : null,
      guidance: typeof p['guidance'] === 'string' ? p['guidance'].trim() : null,
      outputSchema: (typeof p['output_schema'] === 'object' && p['output_schema'] !== null)
        ? p['output_schema'] as Record<string, unknown>
        : null,
    };
  });
}

export function loadMethodology(registryPath: string, methodologyId: string, methodId: string, fs: CoreFileSystem = defaultFs): LoadedMethod {
  // Primary path: registry/{mid}/{methid}/{methid}.yaml
  let filePath = join(registryPath, methodologyId, methodId, `${methodId}.yaml`);

  if (!fs.existsSync(filePath)) {
    // Fallback: registry/{mid}/{mid}.yaml only when loading the methodology itself
    if (methodologyId === methodId) {
      const fallback = join(registryPath, methodologyId, `${methodologyId}.yaml`);
      if (fs.existsSync(fallback)) {
        filePath = fallback;
      } else {
        throw new Error(`Method ${methodId} not found under methodology ${methodologyId}`);
      }
    } else {
      throw new Error(`Method ${methodId} not found under methodology ${methodologyId}`);
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = readYaml(filePath, fs);
  } catch (e) {
    if ((e as Error).message.startsWith('Failed to parse') || (e as Error).message.startsWith('Method ') || (e as Error).message.startsWith('YAML at')) {
      throw e;
    }
    throw new Error(`Failed to parse ${filePath}: ${(e as Error).message}`);
  }

  const steps = extractPhases(parsed, filePath);

  const method = parsed['method'] as Record<string, unknown> | undefined;
  const methodology = parsed['methodology'] as Record<string, unknown> | undefined;
  const meta = method ?? methodology ?? {};

  const objective = parsed['objective'] as Record<string, unknown> | undefined;
  const objectiveText = objective
    ? extractString(objective, 'formal', 'formal_statement')
    : null;

  return {
    methodologyId,
    methodId,
    name: extractString(meta, 'name') ?? methodId,
    objective: objectiveText,
    steps,
  };
}

function findYamlFiles(dirPath: string, fs: CoreFileSystem): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...findYamlFiles(fullPath, fs));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function listMethodologies(registryPath: string, fs: CoreFileSystem = defaultFs): MethodologyEntry[] {
  const entries = fs.readdirSync(registryPath, { withFileTypes: true });
  const methodologyDirs = entries.filter((e: { name: string; isDirectory(): boolean }) => e.isDirectory());

  const result: MethodologyEntry[] = [];

  for (const dir of methodologyDirs) {
    const methodologyDir = join(registryPath, dir.name);
    const yamlFiles = findYamlFiles(methodologyDir, fs);

    let methodologyId = dir.name;
    let methodologyName = dir.name;
    let methodologyDescription = '';
    const methods: MethodEntry[] = [];

    for (const filePath of yamlFiles) {
      let parsed: Record<string, unknown>;
      try {
        parsed = readYaml(filePath, fs);
      } catch {
        continue; // skip unparseable files
      }

      const methodBlock = parsed['method'] as Record<string, unknown> | undefined;
      const methodologyBlock = parsed['methodology'] as Record<string, unknown> | undefined;

      if (methodologyBlock) {
        // Methodology-level YAML
        methodologyId = extractString(methodologyBlock, 'id') ?? dir.name;
        methodologyName = extractString(methodologyBlock, 'name') ?? dir.name;
        const nav = parsed['navigation'] as Record<string, unknown> | undefined;
        methodologyDescription = extractString(nav ?? {}, 'what')
          ?? extractString(methodologyBlock, 'description')
          ?? '';
      } else if (methodBlock) {
        // Method-level YAML
        const phases = parsed['phases'] as unknown[] | undefined;
        const nav = parsed['navigation'] as Record<string, unknown> | undefined;
        methods.push({
          methodId: extractString(methodBlock, 'id') ?? basename(filePath, '.yaml'),
          name: extractString(methodBlock, 'name') ?? basename(filePath, '.yaml'),
          description: extractString(nav ?? {}, 'what')
            ?? extractString(methodBlock, 'description')
            ?? '',
          stepCount: Array.isArray(phases) ? phases.length : 0,
        });
      }
    }

    result.push({
      methodologyId,
      name: methodologyName,
      description: methodologyDescription,
      methods: methods.sort((a, b) => a.methodId.localeCompare(b.methodId)),
    });
  }

  return result.sort((a, b) => a.methodologyId.localeCompare(b.methodologyId));
}
