/**
 * Server-side API helpers — used in Server Components.
 * Fetches directly from the backend API URL (env var, never exposed to browser).
 */
import type { Methodology, MethodologySummary, Session, Project, Stats } from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:47821';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export function listMethodologies(): Promise<MethodologySummary[]> {
  return apiFetch('/methodologies');
}

export function getMethodology(name: string): Promise<Methodology> {
  return apiFetch(`/methodologies/${encodeURIComponent(name)}`);
}

export function listSessions(project?: string): Promise<Session[]> {
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  return apiFetch(`/sessions${qs}`);
}

export function getSession(id: string): Promise<Session> {
  return apiFetch(`/sessions/${encodeURIComponent(id)}`);
}

export function listProjects(): Promise<Project[]> {
  return apiFetch('/projects');
}

export function getStats(): Promise<Stats> {
  return apiFetch('/stats');
}
