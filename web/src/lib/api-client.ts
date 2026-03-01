/**
 * Client-side API helpers — used in Client Components.
 * Fetches from /api/* which Next.js proxies to the backend.
 */
import type { Methodology, MethodologySummary, Session, PhaseEvent, Stats } from './types';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export function listMethodologies(): Promise<MethodologySummary[]> {
  return apiFetch('/methodologies');
}

export function getMethodology(name: string): Promise<Methodology> {
  return apiFetch(`/methodologies/${encodeURIComponent(name)}`);
}

export function listSessions(status?: string): Promise<Session[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch(`/sessions${qs}`);
}

export function getRecentEvents(limit = 50): Promise<PhaseEvent[]> {
  return apiFetch(`/events?limit=${limit}`);
}

export function getStats(): Promise<Stats> {
  return apiFetch('/stats');
}
