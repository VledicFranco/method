export interface MethodologySummary {
  name: string;
  description: string;
  phase_count: number;
}

export interface PhaseField {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  min_items?: number;
  soft?: boolean;
}

export interface Phase {
  id: number;
  name: string;
  guidance: string;
  output_schema: PhaseField[];
}

export interface Methodology {
  name: string;
  description: string;
  phases: Phase[];
}
