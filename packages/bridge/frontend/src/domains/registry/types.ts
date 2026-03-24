/** PRD 019.2: Registry API response types for the frontend */

export interface RegistryMethodSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  type: 'method' | 'protocol';
  wip_count: number;
}

export interface RegistryMethodologySummary {
  id: string;
  name: string;
  version: string;
  status: string;
  method_count: number;
  methods: RegistryMethodSummary[];
}

export interface RegistryTree {
  methodologies: RegistryMethodologySummary[];
  totals: {
    methodologies: number;
    methods: number;
    protocols: number;
    compiled: number;
    draft: number;
  };
  cached_at: string;
}

export interface ManifestEntry {
  id: string;
  type: string;
  version: string;
  registry_version: string | null;
  sync_status: 'current' | 'outdated' | 'ahead' | 'not_found';
  card?: string;
  card_version?: string;
  instance_id?: string;
  artifacts: string[];
  status?: string;
  extends?: string;
  note?: string;
}

export interface ManifestResponse {
  project: string;
  last_updated: string;
  installed: ManifestEntry[];
}

// ── Method Detail (full parsed YAML) ──

export interface MethodNavigation {
  what?: string;
  who?: string;
  why?: string;
  how?: string;
  when_to_use?: string[];
  when_to_invoke?: string[];
  when_not_to_use?: string[];
  when_not_to_invoke?: string[];
}

export interface DomainSort {
  name: string;
  cardinality?: string;
  description?: string;
}

export interface DomainPredicate {
  name: string;
  signature?: string;
  description?: string;
}

export interface DomainFunctionSymbol {
  name: string;
  signature?: string;
  totality?: string;
  description?: string;
}

export interface DomainAxiom {
  id: string;
  name: string;
  statement?: string;
  rationale?: string;
  operationalization?: string;
}

export interface DomainTheory {
  id?: string;
  sorts?: DomainSort[];
  predicates?: DomainPredicate[];
  function_symbols?: DomainFunctionSymbol[];
  axioms?: DomainAxiom[];
}

export interface StepPhase {
  id: string;
  name: string;
  precondition?: string;
  postcondition?: string;
  initial_condition_claim?: string;
  terminal_condition_claim?: string;
  guidance_adequacy?: string;
  execution_binding?: string;
  [key: string]: unknown;
}

export interface CompilationGate {
  gate: string;
  result: string;
  note?: string;
}

export interface CompilationRecord {
  gates: CompilationGate[];
}

export interface KnownWipItem {
  id: string;
  status: string;
  description?: string;
  evidence?: string;
  council_decisions?: string[];
}

export interface ProtocolInstallation {
  description?: string;
  artifacts?: Array<{
    path: string;
    type?: string;
    required?: boolean;
    description?: string;
    human_input_needed?: boolean;
    template_note?: string;
  }>;
  [key: string]: unknown;
}

export interface PromotionCriterion {
  criterion?: string;
  metric?: string;
  threshold?: string;
  result?: string;
  evidence?: string;
  met?: boolean;
}

/** Represents a fully parsed method or protocol YAML */
export interface MethodDetail {
  method?: {
    id: string;
    parent?: string;
    name: string;
    description?: string;
    version: string;
    status: string;
    compilation_date?: string;
    evolution_note?: string;
    formal_grounding?: string;
    [key: string]: unknown;
  };
  protocol?: {
    id: string;
    name: string;
    description?: string;
    version: string;
    status: string;
    date?: string;
    promotion_date?: string;
    maturity?: string;
    extends?: string;
    installation?: ProtocolInstallation;
    promotion_status?: {
      current_stage?: string;
      stages?: Array<{
        name: string;
        description?: string;
        criteria_to_advance?: unknown;
      }>;
    };
    [key: string]: unknown;
  };
  navigation?: MethodNavigation;
  domain_theory?: DomainTheory;
  phases?: StepPhase[];
  step_dag?: {
    topology?: string;
    formal?: unknown;
    steps?: StepPhase[];
  };
  compilation_record?: CompilationRecord;
  known_wip?: KnownWipItem[];
  roles?: unknown;
  composability?: unknown;
  [key: string]: unknown;
}

/** Promotion record (e.g., RETRO-PROTO-PROMOTION.yaml) */
export interface PromotionRecord {
  proposal?: {
    id: string;
    name: string;
    date?: string;
    status?: string;
    summary?: string;
    criteria_met?: PromotionCriterion[];
    [key: string]: unknown;
  };
}
