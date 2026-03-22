/**
 * Raw YAML file structure types — the shape of registry YAML files as parsed by js-yaml.
 *
 * Used by both @method/core's loader and @method/methodts's YAML adapter
 * to parse the same registry files into their respective type systems.
 */

/** Raw YAML structure for a method file. */
export type YamlMethod = {
  readonly method?: {
    readonly id: string;
    readonly name: string;
    readonly objective?: string;
    readonly description?: string;
    readonly version?: string;
    readonly status?: string;
  };
  readonly phases?: readonly YamlPhase[];
  readonly roles?: readonly YamlRole[];
  readonly domain_theory?: YamlDomainTheory;
  readonly navigation?: Readonly<Record<string, string>>;
};

/** A step/phase in a method YAML. */
export type YamlPhase = {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly precondition?: string;
  readonly postcondition?: string;
  readonly guidance?: string;
  readonly output_schema?: Readonly<Record<string, unknown>>;
};

/** A role definition in YAML. */
export type YamlRole = {
  readonly id: string;
  readonly description?: string;
  readonly authorized?: readonly string[];
  readonly not_authorized?: readonly string[];
  readonly phases?: readonly string[];
  readonly authorized_transitions?: readonly string[];
};

/** Domain theory section in YAML. */
export type YamlDomainTheory = {
  readonly id: string;
  readonly reference?: string;
  readonly sorts?: readonly YamlSort[];
  readonly predicates?: readonly YamlPredicate[];
  readonly function_symbols?: readonly YamlFunctionSymbol[];
  readonly axioms?: readonly YamlAxiom[];
};

export type YamlSort = {
  readonly name: string;
  readonly description?: string;
  readonly cardinality?: string;
  readonly values?: readonly string[];
};

export type YamlPredicate = {
  readonly name: string;
  readonly signature?: string;
  readonly description?: string;
};

export type YamlFunctionSymbol = {
  readonly name: string;
  readonly signature?: string;
  readonly totality?: string;
  readonly description?: string;
  readonly note?: string;
};

export type YamlAxiom = {
  readonly id?: string;
  readonly name?: string;
  readonly statement?: string;
  readonly rationale?: string;
};

/** Raw YAML structure for a methodology file. */
export type YamlMethodology = {
  readonly methodology?: {
    readonly id: string;
    readonly name: string;
    readonly version?: string;
    readonly status?: string;
    readonly description?: string;
  };
  readonly domain_theory?: YamlDomainTheory;
  readonly transition_function?: {
    readonly id: string;
    readonly arms?: readonly YamlArm[];
  };
  readonly predicate_operationalization?: {
    readonly predicates?: readonly YamlOperationalPredicate[];
    readonly evaluation_order?: string;
  };
};

/** A transition arm in methodology YAML. */
export type YamlArm = {
  readonly priority: number;
  readonly label: string;
  readonly condition: string;
  readonly returns?: string;
  readonly selects?: string;
  readonly rationale?: string;
};

/** Operationalized predicate definition. */
export type YamlOperationalPredicate = {
  readonly name: string;
  readonly true_when?: string;
  readonly false_when?: string;
};

/** Raw YAML structure for a strategy file (PRD 017). */
export type YamlStrategy = {
  readonly strategy?: {
    readonly id: string;
    readonly name: string;
    readonly version?: string;
  };
  readonly nodes?: readonly YamlStrategyNode[];
  readonly gates?: readonly YamlStrategyGate[];
};

export type YamlStrategyNode = {
  readonly id: string;
  readonly methodology_id?: string;
  readonly method_id?: string;
  readonly depends_on?: readonly string[];
};

export type YamlStrategyGate = {
  readonly id: string;
  readonly type?: string;
  readonly command?: string;
  readonly expected?: unknown;
};
