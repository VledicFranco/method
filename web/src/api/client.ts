import type { Methodology, MethodologySummary } from './types.js';

const BASE = '/api';

export async function listMethodologies(): Promise<MethodologySummary[]> {
  const res = await fetch(`${BASE}/methodologies`);
  if (!res.ok) throw new Error(`Failed to fetch methodologies: ${res.status}`);
  return res.json() as Promise<MethodologySummary[]>;
}

export async function getMethodology(name: string): Promise<Methodology> {
  const res = await fetch(`${BASE}/methodologies/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to fetch methodology "${name}": ${res.status}`);
  return res.json() as Promise<Methodology>;
}
