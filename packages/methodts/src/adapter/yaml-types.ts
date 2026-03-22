/**
 * Raw YAML schema types — the structure of registry YAML files.
 *
 * These types mirror the shape of `registry/` YAML files as parsed by js-yaml.
 * They are the input to the adapter; MethodTS types are the output.
 */

/** Raw YAML structure for a method file. */
export type YamlMethod = {
  method?: { id: string; name: string; objective?: string; description?: string; version?: string };
  phases?: YamlPhase[];
  roles?: YamlRole[];
  domain_theory?: YamlDomainTheory;
};

export type YamlPhase = {
  id: string;
  name: string;
  role?: string;
  precondition?: string;
  postcondition?: string;
  guidance?: string;
  output_schema?: Record<string, unknown>;
};

export type YamlRole = {
  id: string;
  description?: string;
  authorized?: string[];
  not_authorized?: string[];
  phases?: string[];
  authorized_transitions?: string[];
};

export type YamlDomainTheory = {
  id: string;
  sorts?: Array<{ name: string; description?: string; cardinality?: string }>;
  predicates?: Array<{ name: string; signature?: string; description?: string }>;
  function_symbols?: Array<{ name: string; signature?: string; totality?: string; description?: string }>;
  axioms?: Array<{ id?: string; name?: string; statement?: string }>;
};

/** Raw YAML structure for a methodology file. */
export type YamlMethodology = {
  methodology?: { id: string; name: string; version?: string };
  domain_theory?: YamlDomainTheory;
  transition_function?: {
    id: string;
    arms?: YamlArm[];
  };
};

export type YamlArm = {
  priority: number;
  label: string;
  condition: string;
  selects?: string;
  returns?: string;
  rationale?: string;
};
