import type { Phase } from '../schema.js';

export function renderGuidance(
  phase: Phase,
  context: Record<string, unknown>,
  totalPhases?: number,
): string {
  const variables: Record<string, string> = {
    topic: String(context['topic'] ?? ''),
    role: phase.role ?? '—',
    phase_id: String(phase.id),
    phase_name: phase.name,
    total_phases: String(totalPhases ?? ''),
  };

  return phase.guidance.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return variables[key] ?? `{{${key}}}`;
  });
}
