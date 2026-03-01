import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, projects, phase_events } from '../db/schema.js';
import type { Methodology } from '../schema.js';

export type SessionStatus = 'active' | 'complete';

export type SessionState = {
  id: string;
  methodology: string;
  project_id: string | null;
  topic: string;
  status: SessionStatus;
  current_phase: number;
  total_phases: number;
  delta: number;
  completed_phases: number[];
  context: Record<string, unknown>;
  phase_outputs: Record<number, Record<string, unknown>>;
};

function generateId(): string {
  return 'sess_' + randomBytes(6).toString('hex');
}

function computeDelta(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100) / 100;
}

export async function ensureProject(slug: string): Promise<string> {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const inserted = await db
    .insert(projects)
    .values({ slug, name: slug })
    .returning({ id: projects.id });

  return inserted[0].id;
}

export async function createSession(
  methodology: Methodology,
  context: Record<string, unknown>,
  projectSlug?: string,
): Promise<string> {
  const id = generateId();
  const topic = (context.topic as string) ?? '';
  const project_id = projectSlug ? await ensureProject(projectSlug) : null;

  await db.insert(sessions).values({
    id,
    methodology_name: methodology.name,
    project_id,
    topic,
    status: 'active',
    current_phase: 0,
    total_phases: methodology.phases.length,
    delta: 0,
    completed_phases: [],
    context,
    phase_outputs: {},
  });

  return id;
}

export async function getSession(id: string): Promise<SessionState> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (rows.length === 0) throw new Error(`Session not found: ${id}`);

  const row = rows[0];
  return {
    id: row.id,
    methodology: row.methodology_name,
    project_id: row.project_id ?? null,
    topic: row.topic,
    status: row.status as SessionStatus,
    current_phase: row.current_phase,
    total_phases: row.total_phases,
    delta: row.delta,
    completed_phases: row.completed_phases as number[],
    context: row.context as Record<string, unknown>,
    phase_outputs: row.phase_outputs as Record<number, Record<string, unknown>>,
  };
}

export async function advanceSession(
  id: string,
  phaseOutput: Record<string, unknown>,
): Promise<void> {
  const session = await getSession(id);
  const completedPhase = session.current_phase;
  const newOutputs = { ...session.phase_outputs, [completedPhase]: phaseOutput };
  const newCompleted = [...session.completed_phases, completedPhase];
  const newPhase = session.current_phase + 1;
  const newDelta = computeDelta(newCompleted.length, session.total_phases);

  await db
    .update(sessions)
    .set({
      current_phase: newPhase,
      delta: newDelta,
      completed_phases: newCompleted,
      phase_outputs: newOutputs,
      updated_at: new Date(),
    })
    .where(eq(sessions.id, id));
}

export async function completeSession(id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: 'complete', delta: 1.0, updated_at: new Date() })
    .where(eq(sessions.id, id));
}

export async function insertEvent(
  session_id: string,
  phase_index: number,
  event: 'session_started' | 'phase_advanced' | 'validation_failed',
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(phase_events).values({ session_id, phase_index, event, payload });
}
