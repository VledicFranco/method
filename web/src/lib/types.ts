// ── Methodology types ─────────────────────────────────────────────────────

export interface OutputField {
  type: 'string' | 'array' | 'number' | 'boolean';
  items?: string;
  min_items?: number;
  max_items?: number;
  min_length?: number;
  min_value?: number;
  max_value?: number;
  enum?: string[];
  description?: string;
}

export interface Invariant {
  id: string;
  description: string;
  hard: boolean;
}

export interface Phase {
  id: number;
  name: string;
  role: string | null;
  guidance: string;
  // Record<fieldName, OutputField> — NOT an array
  output_schema: Record<string, OutputField>;
  invariants: Invariant[];
}

export interface Methodology {
  name: string;
  description: string;
  version: string;
  phases: Phase[];
}

export interface MethodologySummary {
  name: string;
  description: string;
  phase_count: number;
}

// ── Project types ─────────────────────────────────────────────────────────

export interface Project {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

// ── Session types ─────────────────────────────────────────────────────────

export interface Session {
  id: string;
  methodology_name: string;
  project_id: string | null;
  topic: string;
  status: 'active' | 'complete';
  current_phase: number;
  total_phases: number;
  delta: number;
  completed_phases: number[];
  context: Record<string, unknown>;
  phase_outputs: Record<string, Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface MethodologyStat {
  methodology_name: string;
  count: number;
}

export interface Stats {
  total_sessions: number;
  completed_sessions: number;
  methodologies_count: number;
  sessions_by_methodology: MethodologyStat[];
}

// ── Phase events ──────────────────────────────────────────────────────────

export interface PhaseEvent {
  id: string;
  session_id: string;
  phase_index: number;
  event: 'session_started' | 'phase_advanced' | 'validation_failed';
  payload: Record<string, unknown>;
  created_at: string;
  methodology_name?: string | null;
  project_id?: string | null;
}
