/**
 * MethodTS — Typed Prompt Algebra and Methodology SDK
 * ====================================================
 *
 * The Case for MethodTS
 * ---------------------
 *
 * Every methodology session today burns tokens on work that is not reasoning. An
 * agent reads 2,000 lines of YAML to find a 3-line routing table. An orchestrator
 * spends 800 tokens composing a sub-agent commission that is structurally identical
 * to the last twelve commissions it wrote. A reviewer re-derives the predicate
 * evaluation logic for delta_SD from scratch because the transition function lives
 * in a YAML file it must parse, interpret, and reason about — every single time.
 *
 * The pattern is always the same: deterministic structural work, performed inside a
 * stochastic reasoning engine, at the cost of context window space that should be
 * spent on the actual problem. This is the token tax of untyped methodology execution.
 *
 * MethodTS eliminates the tax by moving deterministic methodology operations into
 * TypeScript. The agent's context window is freed for what agents are good at:
 * judgment, creativity, and domain reasoning. Everything else — prompt composition,
 * predicate evaluation, routing decisions, commission generation, gate checking,
 * step validation — becomes compiled, tested, and instant.
 *
 * The library is grounded in the formal theory (F1-FTH). Every type in MethodTS
 * maps to a definition in the theory: Prompt<A> is the guidance function of
 * Definition 4.1, Predicate<A> is a closed sentence over a domain sort,
 * Method<S> is the 5-tuple of Definition 6.1, Methodology<S> is the coalgebra
 * of Definition 7.1. The theory is the spec; MethodTS is the SDK.
 *
 *
 * Benefits
 * --------
 *
 * 1. TOKEN ECONOMY — Routing, prompt composition, gate evaluation, and commission
 *    generation move from agent reasoning (thousands of tokens) to TypeScript
 *    execution (zero tokens). A delta_SD evaluation that costs an agent ~500 tokens
 *    of YAML reading and chain-of-thought becomes a 1ms function call.
 *
 * 2. TYPE SAFETY — A Prompt<Files> cannot compose with a Prompt<ReviewState>.
 *    A Step whose postcondition references an undeclared sort is a compile error.
 *    A Methodology whose arms reference methods not in its repertoire is caught
 *    before any agent is spawned. Errors that currently surface as confused agent
 *    behavior become red squiggles in the editor.
 *
 * 3. COMPOSABILITY — Prompts compose (andThen, section, when). Predicates compose
 *    (and, or, implies). Steps compose into methods. Methods compose into
 *    methodologies. Every layer is built from the layer below using the same
 *    algebraic operations. You build complex orchestration from simple, tested pieces.
 *
 * 4. DETERMINISM — Agent routing is currently probabilistic: the agent reads delta_Phi
 *    and *reasons* about which arm fires. MethodTS evaluates delta_Phi as a pure
 *    function over typed state. Same input, same output, every time. No reasoning
 *    required. No token cost. No hallucinated routing.
 *
 * 5. TESTABILITY — Prompt composition, predicate evaluation, gate checking, and
 *    commission generation are pure functions. They can be unit tested without
 *    spawning agents, without a bridge, without an MCP server. A test suite for
 *    your methodology's routing logic runs in milliseconds.
 *
 * 6. REUSE — A delivery-rule prompt fragment, a gate predicate, a commission template,
 *    a retrospective schema builder — all are values that can be shared across projects,
 *    published as packages, and versioned independently of the methodology YAML.
 *
 * 7. BRIDGE INTEGRATION — Commission<A> maps directly to bridge_spawn parameters.
 *    A Strategy<S> maps to the strategy executor's DAG. The library doesn't replace
 *    the runtime — it generates the artifacts the runtime consumes.
 *
 *
 * Use Cases
 * ---------
 *
 *  1. COMMISSION GENERATION — Given a methodology session state and a routed method,
 *     produce a complete orchestrator or sub-agent commission prompt. Today this is
 *     800+ tokens of agent reasoning per commission. MethodTS: one function call.
 *
 *  2. ROUTING AUTOMATION — Evaluate delta_Phi (P1-EXEC, P2-SD, P-GH, P3-GOV) as a
 *     TypeScript function. Feed in challenge properties, get back the method ID.
 *     No agent context window needed for the routing decision.
 *
 *  3. BATCH ORCHESTRATION — Generate N commission prompts for bridge_spawn_batch
 *     programmatically. Each prompt is parameterized by its sub-task scope, delivery
 *     rules, and role notes — composed from typed fragments, not hand-written.
 *
 *  4. GATE EVALUATION — Evaluate strategy gates (algorithmic, observation) in
 *     TypeScript. Only escalate to human_approval gates. Saves the agent from
 *     re-deriving gate logic on every pipeline run.
 *
 *  5. STEP VALIDATION — Check step outputs against typed postconditions before
 *     the agent spends tokens on the next step. Fail fast, retry with feedback.
 *
 *  6. RETROSPECTIVE GENERATION — Build structured retro YAML from typed observation
 *     records. The schema is encoded in the type system; missing fields are compile
 *     errors, not runtime omissions.
 *
 *  7. PROJECT CARD TEMPLATING — Generate project-card-aware prompt sections from
 *     a card's delivery rules and role notes. The card is loaded once; prompt
 *     fragments are derived and cached.
 *
 *  8. METHODOLOGY COMPILATION — Define methods and methodologies in TypeScript,
 *     compile to registry YAML. Type-checked at write time, valid by construction.
 *
 *  9. STRATEGY DAG CONSTRUCTION — Build strategy pipelines programmatically with
 *     compile-time dependency checking. Nodes, gates, and artifacts are typed values.
 *
 * 10. STEERING COUNCIL AUTOMATION — Transform council agenda items into typed
 *     commissions. The agenda → challenge → delta evaluation → commission pipeline
 *     becomes a single composed function.
 *
 * 11. PROMPT LIBRARY — Publish reusable prompt fragments: "commit these files",
 *     "run tests and report", "review against delivery rules", "produce retro".
 *     Compose them per-project with contramap and section.
 *
 * 12. DRY-RUN SIMULATION — Walk a methodology's transition function over a sequence
 *     of hypothetical states without executing anything. Verify that the routing
 *     produces the expected method sequence before burning tokens.
 */

// ============================================================================
// PART 1 — PROMPT ALGEBRA
//
// Prompt<A> is the core primitive. It is a function from context A to a string
// instruction. This is the typed form of guidance_σ from F1-FTH Definition 4.1:
//
//   guidance_σ : Context → Text
//
// The type parameter A is contravariant: a Prompt<Animal> can be used wherever a
// Prompt<Dog> is expected (via contramap), because if you can produce instructions
// for any animal, you can certainly produce them for a dog.
//
// Prompts form a monoid under andThen (identity: empty, associative composition).
// This means prompt composition is always safe — you can't produce an invalid
// prompt by composing valid ones.
// ============================================================================

/** A prompt is a function from context to instruction text. */
class Prompt<A> {

  constructor(public readonly run: (a: A) => string) {}

  /** Sequential composition: run this prompt, then the other. */
  andThen(other: Prompt<A>): Prompt<A> {
    return new Prompt<A>(a => {
      const left = this.run(a);
      const right = other.run(a);
      if (!left) return right;
      if (!right) return left;
      return left + "\n\n" + right;
    });
  }

  /**
   * Contravariant map: adapt the context type.
   *
   * If you have a Prompt<ProjectState> and a function (SessionState => ProjectState),
   * you get a Prompt<SessionState>. This is how you specialize general prompts for
   * specific execution contexts.
   */
  contramap<B>(f: (b: B) => A): Prompt<B> {
    return new Prompt<B>(b => this.run(f(b)));
  }

  /** Transform the output string (e.g., wrap in markdown, add prefix). */
  map(f: (s: string) => string): Prompt<A> {
    return new Prompt<A>(a => f(this.run(a)));
  }

  /** Conditional inclusion: emit only when predicate holds on the context. */
  when(predicate: (a: A) => boolean): Prompt<A> {
    return new Prompt<A>(a => predicate(a) ? this.run(a) : "");
  }

  /** Wrap in a labeled section (markdown heading). */
  section(heading: string): Prompt<A> {
    return this.map(body => body ? `## ${heading}\n\n${body}` : "");
  }

  /** Indent every line of the output. */
  indent(spaces: number = 2): Prompt<A> {
    const pad = " ".repeat(spaces);
    return this.map(s => s.split("\n").map(line => pad + line).join("\n"));
  }

  /** Repeat this prompt for each item extracted from context, joining results. */
  forEach<B>(extract: (a: A) => B[], adapt: (pair: [A, B]) => A): Prompt<A> {
    return new Prompt<A>(a => {
      const items = extract(a);
      return items.map(item => this.run(adapt([a, item]))).filter(Boolean).join("\n\n");
    });
  }
}

// -- Prompt constructors --

/** A prompt that always emits the same string, regardless of context. */
function constant<A = unknown>(value: string): Prompt<A> {
  return new Prompt<A>(_ => value);
}

/** The identity prompt — emits nothing. Monoid identity for andThen. */
function empty<A = unknown>(): Prompt<A> {
  return new Prompt<A>(_ => "");
}

/** A prompt built from a tagged template literal with context interpolation. */
function template<A>(strings: TemplateStringsArray, ...keys: ((a: A) => string)[]): Prompt<A> {
  return new Prompt<A>(a =>
    strings.reduce((acc, str, i) =>
      acc + str + (keys[i] ? keys[i](a) : ""), ""
    )
  );
}

/** Compose an array of prompts sequentially (monoid fold). */
function sequence<A>(...prompts: Prompt<A>[]): Prompt<A> {
  return prompts.reduce((acc, p) => acc.andThen(p), empty<A>());
}

/**
 * Conditional prompt: emit `then` if predicate holds, `otherwise` if not.
 * The Prompt-level equivalent of an if-expression.
 */
function cond<A>(
  predicate: (a: A) => boolean,
  then: Prompt<A>,
  otherwise: Prompt<A> = empty<A>()
): Prompt<A> {
  return new Prompt<A>(a => predicate(a) ? then.run(a) : otherwise.run(a));
}

/**
 * Select a prompt based on context (pattern matching over context values).
 * First matching branch wins, fallback if none match.
 */
function match<A>(
  branches: Array<{ when: (a: A) => boolean; then: Prompt<A> }>,
  fallback: Prompt<A> = empty<A>()
): Prompt<A> {
  return new Prompt<A>(a => {
    for (const branch of branches) {
      if (branch.when(a)) return branch.then.run(a);
    }
    return fallback.run(a);
  });
}


// ============================================================================
// PART 2 — PREDICATE ALGEBRA
//
// Predicates are the formal logic layer. They correspond to the closed sentences
// in Ax from F1-FTH Definition 1.1:
//
//   Ax — a finite set of closed Σ-sentences
//
// A Predicate<A> can be evaluated against a value of type A to produce a boolean.
// Predicates compose with the standard logical connectives (and, or, not, implies)
// and quantifiers (forall, exists) — giving you first-order logic over TypeScript
// values.
//
// Predicates serve three purposes in MethodTS:
//   1. Domain axioms — invariants that must hold in all valid states
//   2. Step pre/postconditions — Hoare-triple guards
//   3. Routing conditions — delta_Phi arm guards
// ============================================================================

/** A predicate over values of type A. Algebraic data type with tagged union. */
type Predicate<A> =
  | { tag: "val"; value: boolean }
  | { tag: "check"; label: string; check: (a: A) => boolean }
  | { tag: "and"; left: Predicate<A>; right: Predicate<A> }
  | { tag: "or"; left: Predicate<A>; right: Predicate<A> }
  | { tag: "not"; inner: Predicate<A> }
  | { tag: "implies"; antecedent: Predicate<A>; consequent: Predicate<A> }
  | { tag: "forall"; label: string; elements: (a: A) => A[]; body: Predicate<A> }
  | { tag: "exists"; label: string; elements: (a: A) => A[]; body: Predicate<A> };

// -- Predicate constructors --

/** A literal boolean predicate. */
const TRUE: Predicate<any> = { tag: "val", value: true };
const FALSE: Predicate<any> = { tag: "val", value: false };

/** A named runtime check. The label is for diagnostics — what is being tested. */
function check<A>(label: string, f: (a: A) => boolean): Predicate<A> {
  return { tag: "check", label, check: f };
}

/** Logical conjunction. */
function and<A>(...preds: Predicate<A>[]): Predicate<A> {
  return preds.reduce((acc, p) => ({ tag: "and", left: acc, right: p }));
}

/** Logical disjunction. */
function or<A>(...preds: Predicate<A>[]): Predicate<A> {
  return preds.reduce((acc, p) => ({ tag: "or", left: acc, right: p }));
}

/** Logical negation. */
function not<A>(inner: Predicate<A>): Predicate<A> {
  return { tag: "not", inner };
}

/** Material implication: if antecedent then consequent. */
function implies<A>(antecedent: Predicate<A>, consequent: Predicate<A>): Predicate<A> {
  return { tag: "implies", antecedent, consequent };
}

/** Universal quantification over a sub-collection extracted from context. */
function forall<A>(label: string, elements: (a: A) => A[], body: Predicate<A>): Predicate<A> {
  return { tag: "forall", label, elements, body };
}

/** Existential quantification over a sub-collection extracted from context. */
function exists<A>(label: string, elements: (a: A) => A[], body: Predicate<A>): Predicate<A> {
  return { tag: "exists", label, elements, body };
}

// -- Predicate evaluation --

/**
 * Evaluate a predicate against a concrete value.
 *
 * This is the core operation that replaces agent reasoning about predicates.
 * When an agent evaluates "adversarial_pressure_beneficial(challenge)", it reads
 * the operationalization criteria and reasons through them (~500 tokens). This
 * function does the same thing in microseconds.
 */
function evaluate<A>(pred: Predicate<A>, value: A): boolean {
  switch (pred.tag) {
    case "val": return pred.value;
    case "check": return pred.check(value);
    case "and": return evaluate(pred.left, value) && evaluate(pred.right, value);
    case "or": return evaluate(pred.left, value) || evaluate(pred.right, value);
    case "not": return !evaluate(pred.inner, value);
    case "implies": return !evaluate(pred.antecedent, value) || evaluate(pred.consequent, value);
    case "forall": return pred.elements(value).every(elem => evaluate(pred.body, elem));
    case "exists": return pred.elements(value).some(elem => evaluate(pred.body, elem));
  }
}

/**
 * Collect diagnostic trace from predicate evaluation.
 * Returns the result AND which sub-predicates contributed to it.
 * Useful for explaining routing decisions without agent reasoning.
 */
type EvalTrace = { label: string; result: boolean; children: EvalTrace[] };

function evaluateWithTrace<A>(pred: Predicate<A>, value: A): EvalTrace {
  switch (pred.tag) {
    case "val":
      return { label: `literal(${pred.value})`, result: pred.value, children: [] };
    case "check":
      return { label: pred.label, result: pred.check(value), children: [] };
    case "and": {
      const l = evaluateWithTrace(pred.left, value);
      const r = evaluateWithTrace(pred.right, value);
      return { label: "AND", result: l.result && r.result, children: [l, r] };
    }
    case "or": {
      const l = evaluateWithTrace(pred.left, value);
      const r = evaluateWithTrace(pred.right, value);
      return { label: "OR", result: l.result || r.result, children: [l, r] };
    }
    case "not": {
      const inner = evaluateWithTrace(pred.inner, value);
      return { label: "NOT", result: !inner.result, children: [inner] };
    }
    case "implies": {
      const ant = evaluateWithTrace(pred.antecedent, value);
      const con = evaluateWithTrace(pred.consequent, value);
      return { label: "IMPLIES", result: !ant.result || con.result, children: [ant, con] };
    }
    case "forall": {
      const elems = pred.elements(value);
      const children = elems.map(e => evaluateWithTrace(pred.body, e));
      return { label: `FORALL(${pred.label})`, result: children.every(c => c.result), children };
    }
    case "exists": {
      const elems = pred.elements(value);
      const children = elems.map(e => evaluateWithTrace(pred.body, e));
      return { label: `EXISTS(${pred.label})`, result: children.some(c => c.result), children };
    }
  }
}


// ============================================================================
// PART 3 — GATES AND WITNESSES
//
// A Gate is a predicate evaluation that produces a Witness — proof evidence that
// the predicate held (or a reason it didn't). This corresponds to the gate
// framework in the strategy system (PRD 017) and to the acceptance gates G0-G6
// in M1-MDES's compilation check.
//
// Witnesses are evidence artifacts. A method step that requires its postcondition
// to hold can demand a witness, not just a boolean — forcing the caller to
// provide verifiable evidence, not just an assertion.
// ============================================================================

/** Evidence that a predicate held at evaluation time. */
type Witness<A> = {
  predicate: Predicate<A>;
  evaluatedAt: Date;
  trace: EvalTrace;
};

/** The result of running a gate. */
type GateResult<A> = {
  passed: boolean;
  witness: Witness<A> | null;
  reason: string;
  feedback?: string;
};

/** A gate evaluates a predicate and produces a witnessed result. */
type Gate<A> = {
  id: string;
  description: string;
  predicate: Predicate<A>;
  maxRetries: number;
};

/** Evaluate a gate against a value. */
function evaluateGate<A>(gate: Gate<A>, value: A): GateResult<A> {
  const trace = evaluateWithTrace(gate.predicate, value);
  const passed = trace.result;
  return {
    passed,
    witness: passed ? { predicate: gate.predicate, evaluatedAt: new Date(), trace } : null,
    reason: passed
      ? `Gate ${gate.id} passed`
      : `Gate ${gate.id} failed: ${describeFailure(trace)}`,
    feedback: passed ? undefined : buildRetryFeedback(trace),
  };
}

/** Human-readable explanation of why a gate failed. */
function describeFailure(trace: EvalTrace): string {
  if (!trace.result && trace.children.length === 0) {
    return `${trace.label} evaluated to false`;
  }
  const failedChildren = trace.children.filter(c => !c.result);
  return failedChildren.map(c => describeFailure(c)).join("; ");
}

/** Feedback string suitable for including in a retry prompt. */
function buildRetryFeedback(trace: EvalTrace): string {
  return `The following conditions were not met: ${describeFailure(trace)}. ` +
    `Please address these before resubmitting.`;
}


// ============================================================================
// PART 4 — DOMAIN THEORY
//
// DomainTheory<S> is the typed form of Definition 1.1:
//
//   D = (Σ, Ax) where Σ = (S, Ω, Π)
//
// The type parameter S represents the union of all sort carrier sets. In practice,
// S is the TypeScript type of a world state — the object an agent's step operates
// on. The domain theory declares what properties that state must have (sorts),
// what operations are available (function symbols), what relations hold
// (predicates), and what invariants are guaranteed (axioms).
//
// At the type level, DomainTheory constrains what methods can do.
// At the value level, a DomainTheory instance describes a specific domain.
// ============================================================================

/** A sort declaration — a named type in the domain. */
type SortDecl = {
  name: string;
  description: string;
  cardinality: "finite" | "unbounded" | "singleton";
};

/** A function symbol declaration — a typed operation in the domain. */
type FunctionDecl = {
  name: string;
  signature: string;       // Human-readable, e.g. "Task -> FileScope"
  totality: "total" | "partial";
  description?: string;
};

/** The formal domain theory. S is the world state type. */
type DomainTheory<S> = {
  id: string;
  sorts: SortDecl[];
  functionSymbols: FunctionDecl[];
  predicates: Record<string, Predicate<S>>;
  axioms: Record<string, Predicate<S>>;
};

/**
 * Validate that all axioms hold for a given state.
 * Returns the first failing axiom, or null if all pass.
 *
 * This is Mod(D) membership testing — Definition 1.3:
 *   Mod(D) = { A | A ⊨ ax for all ax ∈ Ax }
 */
function validateAxioms<S>(domain: DomainTheory<S>, state: S): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [name, axiom] of Object.entries(domain.axioms)) {
    if (!evaluate(axiom, state)) {
      violations.push(name);
    }
  }
  return { valid: violations.length === 0, violations };
}


// ============================================================================
// PART 5 — ROLE
//
// Role<S> is Definition 2.1:
//
//   ρ = (π_ρ, α_ρ)
//
// The observation projection π_ρ restricts what the agent sees. In MethodTS
// this is a function that extracts the observable sub-state. The authority α_ρ
// lists what transitions the agent may perform.
//
// Roles enable epistemic separation at the type level: a sub-agent prompt built
// from a Role's projection physically cannot reference state outside its
// observation scope.
// ============================================================================

/** A role definition. V is the observable sub-state type. */
type Role<S, V = S> = {
  id: string;
  description: string;
  /** Observation projection: what the role can see. π_ρ : S → V */
  observe: (state: S) => V;
  /** Authorized transitions: descriptions of what the role may do. */
  authorized: string[];
  /** Not authorized: explicit prohibitions. */
  notAuthorized: string[];
};

/**
 * Build a prompt that only has access to what a role can observe.
 * This is the typed enforcement of epistemic separation.
 */
function scopeToRole<S, V>(role: Role<S, V>, prompt: Prompt<V>): Prompt<S> {
  return prompt.contramap(role.observe);
}


// ============================================================================
// PART 6 — STEP, METHOD, OBJECTIVE
//
// Step<S> is Definition 4.1:
//   σ = (pre_σ, post_σ, guidance_σ, tools_σ)
//
// Method<S> is Definition 6.1:
//   M = (D, Roles, Γ, O, μ⃗)
//
// The step's guidance is a Prompt<S>, not a string. This means the guidance text
// is generated from the current state — it can include context-specific details,
// conditional sections, and role-scoped projections.
// ============================================================================

/** A measure over the state space. Definition 5.3. */
type Measure<S> = {
  id: string;
  name: string;
  compute: (state: S) => number;
  range: [number, number];
  terminal: number;
};

/** A step in a method's DAG. Definition 4.1. */
type Step<S> = {
  id: string;
  name: string;
  role: string;
  precondition: Predicate<S>;
  postcondition: Predicate<S>;
  guidance: Prompt<S>;
  tools?: string[];
  /** Optional gate evaluated on step output. */
  gate?: Gate<S>;
};

/**
 * An edge in the step DAG. Definition 4.3 composability condition:
 *   { s | post_{σ₁}(s) } ⊆ { s | pre_{σ₂}(s) }
 */
type StepEdge = {
  from: string;
  to: string;
};

/** The step DAG. Definition 4.4. */
type StepDAG<S> = {
  steps: Step<S>[];
  edges: StepEdge[];
  initial: string;
  terminal: string;
};

/** A compiled method. Definition 6.1: M = (D, Roles, Γ, O, μ⃗). */
type Method<S> = {
  id: string;
  name: string;
  domain: DomainTheory<S>;
  roles: Role<S, any>[];
  dag: StepDAG<S>;
  objective: Predicate<S>;
  measures: Measure<S>[];
};

/**
 * Verify step composability: does the postcondition of step A
 * imply the precondition of step B for a given state?
 *
 * This is an approximation — true semantic entailment is undecidable (P3),
 * but we can check it for concrete states. Running this over a set of
 * representative states gives confidence without formal proof.
 */
function checkComposability<S>(stepA: Step<S>, stepB: Step<S>, testStates: S[]): {
  composable: boolean;
  counterexample: S | null;
} {
  for (const state of testStates) {
    if (evaluate(stepA.postcondition, state) && !evaluate(stepB.precondition, state)) {
      return { composable: false, counterexample: state };
    }
  }
  return { composable: true, counterexample: null };
}

/**
 * Walk the step DAG and compute topological order.
 * Returns steps in a valid execution sequence.
 */
function topologicalOrder<S>(dag: StepDAG<S>): Step<S>[] {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const stepMap = new Map<string, Step<S>>();

  for (const step of dag.steps) {
    stepMap.set(step.id, step);
    adjacency.set(step.id, []);
    inDegree.set(step.id, 0);
  }

  for (const edge of dag.edges) {
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result: Step<S>[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(stepMap.get(id)!);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return result;
}


// ============================================================================
// PART 7 — METHODOLOGY (COALGEBRA)
//
// Methodology<S> is Definition 7.1:
//   Φ = (D_Φ, δ_Φ, O_Φ)
//
// The transition function δ_Φ is a priority-ordered list of arms, each guarded
// by a predicate. First arm whose predicate holds selects the method. This is
// the coalgebraic heart — the methodology watches state and decides what method
// to run next.
//
// In MethodTS, evaluating delta is a function call, not agent reasoning.
// ============================================================================

/** An arm of the transition function. */
type Arm<S> = {
  priority: number;
  label: string;
  condition: Predicate<S>;
  /** The method to select, or null for termination. */
  selects: Method<S> | null;
  rationale: string;
};

/** A methodology. Definition 7.1: Φ = (D_Φ, δ_Φ, O_Φ). */
type Methodology<S> = {
  id: string;
  name: string;
  domain: DomainTheory<S>;
  arms: Arm<S>[];
  objective: Predicate<S>;
  terminationMeasure: Measure<S>;
};

/** Result of evaluating the transition function. */
type TransitionResult<S> = {
  /** The arm that fired, or null if no arm matched. */
  firedArm: Arm<S> | null;
  /** The selected method, or null if terminating. */
  selectedMethod: Method<S> | null;
  /** Evaluation trace for all arms (for debugging and logging). */
  armTraces: Array<{ label: string; trace: EvalTrace; fired: boolean }>;
};

/**
 * Evaluate the transition function δ_Φ.
 *
 * This is the function that replaces agent routing reasoning. An agent evaluating
 * delta_SD reads ~2000 tokens of YAML, reasons through 7 arms with their predicate
 * operationalizations, and produces a method selection in ~500 tokens of output.
 * This function does the same thing deterministically.
 *
 * Arms are evaluated in strict priority order. First arm whose condition holds
 * wins. If no arm matches, returns null (the methodology should terminate or
 * there is a completeness gap in the arm conditions).
 */
function evaluateTransition<S>(methodology: Methodology<S>, state: S): TransitionResult<S> {
  const sorted = [...methodology.arms].sort((a, b) => a.priority - b.priority);
  const armTraces: TransitionResult<S>["armTraces"] = [];
  let firedArm: Arm<S> | null = null;

  for (const arm of sorted) {
    const trace = evaluateWithTrace(arm.condition, state);
    const fired = trace.result && firedArm === null;
    armTraces.push({ label: arm.label, trace, fired });
    if (fired) {
      firedArm = arm;
    }
  }

  return {
    firedArm,
    selectedMethod: firedArm?.selects ?? null,
    armTraces,
  };
}


// ============================================================================
// PART 8 — DOMAIN RETRACTION
//
// Definition 6.3: when a step delegates to a sub-method, a domain retraction
// pair (embed, project) connects the parent and child domains:
//
//   embed   : Mod(D)  → Mod(D')
//   project : Mod(D') → Mod(D)
//   project ∘ embed = id  (on the touched subspace)
//
// In MethodTS, retractions are typed functions. The type system enforces that
// embed produces the child's state type and project recovers the parent's.
// ============================================================================

/**
 * A domain retraction pair connecting parent state P to child state C.
 *
 * The retraction condition (project ∘ embed ≈ id) can be checked at test time
 * via verifyRetraction().
 */
type Retraction<P, C> = {
  id: string;
  embed: (parent: P) => C;
  project: (child: C) => P;
};

/**
 * Test the retraction condition: project(embed(s)) should equal s on the
 * dimensions that the child method touches.
 *
 * `compare` extracts the dimensions to check. If omitted, uses JSON equality
 * on the full state (conservative but may be too strict).
 */
function verifyRetraction<P, C>(
  retraction: Retraction<P, C>,
  testStates: P[],
  compare?: (original: P, roundTripped: P) => boolean
): { valid: boolean; counterexample: P | null } {
  const eq = compare ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  for (const state of testStates) {
    const roundTripped = retraction.project(retraction.embed(state));
    if (!eq(state, roundTripped)) {
      return { valid: false, counterexample: state };
    }
  }
  return { valid: true, counterexample: null };
}


// ============================================================================
// PART 9 — COMMISSION
//
// A Commission is the bridge between typed methodology logic and agent execution.
// It captures everything needed to spawn an agent session: the prompt (generated
// from a Prompt<A>), the bridge parameters, and the governance context.
//
// Commission<A> is the output type of MethodTS → Bridge integration. You compose
// your prompts, evaluate your routing, and then "render" the result into a
// commission that bridge_spawn can execute.
// ============================================================================

/** Bridge spawn parameters — maps to the bridge_spawn MCP tool input. */
type BridgeParams = {
  workdir: string;
  nickname?: string;
  purpose?: string;
  parentSessionId?: string;
  depth?: number;
  budget?: { maxDepth: number; maxAgents: number };
  isolation?: "worktree" | "shared";
  timeoutMs?: number;
  mode?: "pty" | "print";
  spawnArgs?: string[];
};

/**
 * A commission: a rendered prompt plus everything needed to spawn an agent.
 *
 * This is the terminal value of the MethodTS pipeline:
 *   define prompts → compose → evaluate routing → render commission
 *
 * The commission can be handed to bridge_spawn directly, or serialized for
 * later execution, or logged for audit.
 */
type Commission<A> = {
  /** The rendered prompt text, ready to send to an agent. */
  prompt: string;
  /** The context that was used to render the prompt (for traceability). */
  context: A;
  /** Bridge spawn parameters. */
  bridge: BridgeParams;
  /** Governance traceability. */
  metadata: {
    generatedAt: Date;
    methodologyId?: string;
    methodId?: string;
    stepId?: string;
    routingTrace?: TransitionResult<any>;
  };
};

/** Render a prompt into a commission, ready for bridge_spawn. */
function commission<A>(
  prompt: Prompt<A>,
  context: A,
  bridge: BridgeParams,
  metadata?: Commission<A>["metadata"]
): Commission<A> {
  return {
    prompt: prompt.run(context),
    context,
    bridge,
    metadata: metadata ?? { generatedAt: new Date() },
  };
}

/** Render multiple commissions for bridge_spawn_batch. */
function batchCommission<A>(
  prompt: Prompt<A>,
  contexts: A[],
  bridge: (context: A, index: number) => BridgeParams
): Commission<A>[] {
  return contexts.map((ctx, i) => commission(prompt, ctx, bridge(ctx, i)));
}


// ============================================================================
// PART 10 — STRATEGY DAG
//
// Strategy<S> is the typed form of the strategy pipeline system (PRD 017).
// A strategy is a DAG of nodes, each producing artifacts consumed by downstream
// nodes. Gates guard transitions. The whole thing compiles to the YAML format
// that core's StrategyExecutor consumes.
//
// The advantage of defining strategies in MethodTS vs YAML: dependency references
// are checked at compile time, artifact types flow through the DAG, and gate
// predicates are the same Predicate<A> values used everywhere else.
// ============================================================================

/** A node in a strategy DAG. */
type StrategyNode<S> = {
  id: string;
  dependsOn: string[];
  /** The prompt to execute at this node. */
  prompt: Prompt<S>;
  /** Gates that must pass before advancing past this node. */
  gates: Gate<S>[];
  /** Artifacts this node produces (by name). */
  outputs: string[];
};

/** A typed strategy DAG. */
type Strategy<S> = {
  id: string;
  name: string;
  nodes: StrategyNode<S>[];
  contextInputs: string[];
};

/**
 * Validate a strategy DAG: check for cycles, dangling references,
 * and unreachable nodes.
 */
function validateStrategy<S>(strategy: Strategy<S>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const nodeIds = new Set(strategy.nodes.map(n => n.id));

  // Check for dangling dependency references
  for (const node of strategy.nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  // Check for duplicate IDs
  if (nodeIds.size !== strategy.nodes.length) {
    errors.push("Duplicate node IDs detected");
  }

  // Check for cycles (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of strategy.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const node of strategy.nodes) {
    for (const dep of node.dependsOn) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(id) ?? []) {
      const nd = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, nd);
      if (nd === 0) queue.push(neighbor);
    }
  }
  if (visited !== strategy.nodes.length) {
    errors.push("Cycle detected in strategy DAG");
  }

  return { valid: errors.length === 0, errors };
}


// ============================================================================
// PART 11 — EXAMPLES
//
// Concrete examples showing how the algebra composes in practice.
// ============================================================================

// --- Example: File commit prompt ---

type FileContext = {
  files: string[];
  branch: string;
  commitMessage: string;
};

const listFiles: Prompt<FileContext> = new Prompt(ctx =>
  `Files to commit:\n${ctx.files.map(f => `  - ${f}`).join("\n")}`
);

const commitInstruction: Prompt<FileContext> = new Prompt(ctx =>
  `Stage and commit these files on branch "${ctx.branch}" with message: "${ctx.commitMessage}"`
);

const pushInstruction: Prompt<FileContext> = new Prompt(ctx =>
  `Push branch "${ctx.branch}" to origin.`
);

const gitFlow: Prompt<FileContext> = sequence(
  listFiles.section("Files"),
  commitInstruction.section("Commit"),
  pushInstruction.section("Push"),
);

// --- Example: Conditional review prompt ---

type ReviewContext = {
  prNumber: number;
  filesChanged: number;
  touchesArchitecture: boolean;
  deliveryRules: string[];
};

const basicReview: Prompt<ReviewContext> = new Prompt(ctx =>
  `Review PR #${ctx.prNumber}. Check each changed file against delivery rules.`
);

const architectureWarning: Prompt<ReviewContext> = constant<ReviewContext>(
  "This PR touches architecture. Verify alignment with docs/arch/ specs."
).when(ctx => ctx.touchesArchitecture);

const deliveryRuleChecklist: Prompt<ReviewContext> = new Prompt(ctx =>
  `Delivery rules to check:\n${ctx.deliveryRules.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`
);

const reviewPrompt: Prompt<ReviewContext> = sequence(
  basicReview,
  architectureWarning,
  deliveryRuleChecklist.section("Delivery Rules"),
);

// --- Example: Routing via delta_EXEC predicates ---

type ExecState = {
  challenge: string;
  problemFramingUncertain: boolean;
  multipleDefensiblePositions: boolean;
  irreversibleCommitment: boolean;
  decomposableBeforeExecution: boolean;
  taskCount: number;
};

const adversarialPressureBeneficial = or<ExecState>(
  check("PFU", s => s.problemFramingUncertain),
  check("MDP", s => s.multipleDefensiblePositions),
  check("C3", s => s.irreversibleCommitment),
);

// Delta_EXEC as a typed methodology (simplified — methods as null placeholders)
const deltaExec: Arm<ExecState>[] = [
  {
    priority: 1,
    label: "adversarial_dispatch",
    condition: adversarialPressureBeneficial,
    selects: null, // would be M1-COUNCIL
    rationale: "Route to structured multi-perspective debate.",
  },
  {
    priority: 2,
    label: "orchestration_dispatch",
    condition: and(
      not(adversarialPressureBeneficial),
      check("decomposable", s => s.decomposableBeforeExecution),
      check("n>=3", s => s.taskCount >= 3),
    ),
    selects: null, // would be M2-ORCH
    rationale: "Route to parallel orchestration.",
  },
  {
    priority: 3,
    label: "sequential_dispatch",
    condition: and(
      not(adversarialPressureBeneficial),
      not(check("decomposable", s => s.decomposableBeforeExecution)),
    ),
    selects: null, // would be M3-TMP
    rationale: "Default: single-agent sequential reasoning.",
  },
];

// Evaluate routing — zero tokens, deterministic
// const result = evaluateTransition(
//   { id: "P1-EXEC", name: "Execution", domain: ..., arms: deltaExec, objective: ..., terminationMeasure: ... },
//   { challenge: "Implement login endpoint", problemFramingUncertain: false, ... }
// );
// result.firedArm.label === "sequential_dispatch"  ← M3-TMP, no agent reasoning needed

// --- Example: Commission generation for sub-agent ---

type SubTaskContext = {
  taskId: string;
  description: string;
  scope: string[];
  deliveryRules: string[];
  returnFormat: string;
};

const subAgentCommission: Prompt<SubTaskContext> = sequence(
  new Prompt<SubTaskContext>(ctx =>
    `You are an implementation sub-agent. Your task: ${ctx.description}`
  ).section("Role"),
  new Prompt<SubTaskContext>(ctx =>
    `You may ONLY modify files in:\n${ctx.scope.map(f => `  - ${f}`).join("\n")}\n` +
    `Do NOT modify files outside this scope. Report out-of-scope needs, do not act on them.`
  ).section("Scope"),
  deliveryRuleChecklist.contramap<SubTaskContext>(ctx => ({
    prNumber: 0, filesChanged: 0, touchesArchitecture: false,
    deliveryRules: ctx.deliveryRules,
  })).section("Constraints"),
  new Prompt<SubTaskContext>(ctx =>
    `Return your results in this format:\n${ctx.returnFormat}`
  ).section("Output"),
);

// Render commission for bridge_spawn:
// const comm = commission(subAgentCommission, taskContext, {
//   workdir: "/path/to/project",
//   nickname: `impl-${taskContext.taskId}`,
//   purpose: taskContext.description,
//   isolation: "worktree",
// });
// → comm.prompt is the full prompt text
// → comm.bridge is the spawn config

// --- Example: Batch commission for M2-DIMPL parallel dispatch ---
// const tasks: SubTaskContext[] = phaseDoc.tasks.map(t => ({ ... }));
// const commissions = batchCommission(subAgentCommission, tasks, (ctx, i) => ({
//   workdir: "/path/to/project",
//   nickname: `impl-${ctx.taskId}`,
//   purpose: ctx.description,
//   isolation: "worktree",
// }));
// → commissions is ready for bridge_spawn_batch


// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Prompt algebra
  Prompt, constant, empty, template, sequence, cond, match,

  // Predicate algebra
  type Predicate, TRUE, FALSE,
  check, and, or, not, implies, forall, exists,
  evaluate, evaluateWithTrace, type EvalTrace,

  // Gates and witnesses
  type Witness, type Gate, type GateResult,
  evaluateGate,

  // Domain theory
  type DomainTheory, type SortDecl, type FunctionDecl,
  validateAxioms,

  // Roles
  type Role, scopeToRole,

  // Steps and methods
  type Step, type StepEdge, type StepDAG, type Method, type Measure,
  checkComposability, topologicalOrder,

  // Methodology (coalgebra)
  type Arm, type Methodology, type TransitionResult,
  evaluateTransition,

  // Domain retraction
  type Retraction, verifyRetraction,

  // Commission
  type Commission, type BridgeParams,
  commission, batchCommission,

  // Strategy
  type StrategyNode, type Strategy,
  validateStrategy,
};
