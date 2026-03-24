export type Step = {
  id: string;
  name: string;
  role: string | null;
  precondition: string | null;
  postcondition: string | null;
  guidance: string | null;
  outputSchema: Record<string, unknown> | null;
};

export type LoadedMethod = {
  methodologyId: string;
  methodId: string;
  name: string;
  objective: string | null;
  steps: Step[];
};

export type MethodEntry = {
  methodId: string;
  name: string;
  description: string;
  stepCount: number;
};

export type MethodologyEntry = {
  methodologyId: string;
  name: string;
  description: string;
  methods: MethodEntry[];
};

export type TheoryResult = {
  source: string;
  section: string;
  label?: string;
  content: string;
};

/** Minimal filesystem abstraction for core (DR-03: zero transport deps). */
export interface CoreFileSystem {
  readFileSync(path: string, encoding: 'utf-8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
  existsSync(path: string): boolean;
}
