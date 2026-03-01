import { randomBytes } from 'node:crypto';
import type { Methodology } from '../schema.js';

export type SessionStatus = 'active' | 'complete';

export type SessionState = {
  methodology: string;
  status: SessionStatus;
  current_phase: number;
  total_phases: number;
  delta: number;
  completed_phases: number[];
  context: Record<string, unknown>;
  phase_outputs: Record<number, Record<string, unknown>>;
};

const sessions = new Map<string, SessionState>();

function generateId(): string {
  return 'sess_' + randomBytes(6).toString('hex');
}

function computeDelta(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100) / 100;
}

export function createSession(
  methodology: Methodology,
  context: Record<string, unknown>,
): string {
  const id = generateId();
  sessions.set(id, {
    methodology: methodology.name,
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

export function getSession(id: string): SessionState {
  const session = sessions.get(id);
  if (!session) throw new Error(`Session not found: ${id}`);
  return session;
}

export function advanceSession(
  id: string,
  phaseOutput: Record<string, unknown>,
): void {
  const session = getSession(id);
  const completedPhase = session.current_phase;
  session.phase_outputs[completedPhase] = phaseOutput;
  session.completed_phases.push(completedPhase);
  session.current_phase += 1;
  session.delta = computeDelta(session.completed_phases.length, session.total_phases);
}

export function completeSession(id: string): void {
  const session = getSession(id);
  session.status = 'complete';
  session.delta = 1.0;
}
