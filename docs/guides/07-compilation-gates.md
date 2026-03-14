# Guide 7 — Compilation Gates (G0-G6)

Every method in the system must pass 7 acceptance gates before it's considered **compiled**. The gates verify structural completeness — they check that the method is well-formed, not that it's good. A method can pass all gates and still be poorly designed; but a method that fails a gate has a structural defect that will cause problems at runtime.

Gates are evaluated **in order**. A failure at gate N stops evaluation — later gates can't be meaningfully checked when earlier ones fail.

## G0 — Navigability

**What it checks:** Can someone understand what this method does without reading the formal theory?

**Requirements:**
- **What:** What the method produces. What "success" or "compiled" looks like.
- **Who:** What roles use this method. Whether LLM or human execution is the target.
- **Why:** What problem it solves. What breaks without it.
- **How:** High-level description of the step structure.
- **When:** Input conditions (when to use) and boundary conditions (when to route elsewhere).

**Common failure:** The method jumps straight into domain theory without explaining what it's for. Every method needs a `navigation` section that a non-theorist can read.

**Repair target:** Add or expand the `navigation` section.

## G1 — Domain Theory Validity

**What it checks:** Is the formal world well-defined?

**Requirements:**
- At least one sort declared with name, description, and cardinality
- All predicates have typed signatures referencing **only declared sorts**
- All axioms are **closed sentences** — no free variables (every variable bound by ∀ or ∃)
- No trivially contradictory axiom pairs
- `initial_state_valid_claim`: why the starting state satisfies all axioms
- `terminal_state_valid_claim`: why the ending state satisfies all axioms
- `domain_boundary_note`: what is explicitly excluded

**Common failures:**
- A predicate references a sort that isn't declared (e.g., `holds(Character x Position x Timestamp)` but Timestamp isn't a sort)
- An axiom uses informal language instead of a closed formal sentence (e.g., "characters should not repeat positions" instead of a quantified statement)
- Missing state validity claims — the method doesn't verify that its intended initial and terminal states are valid models

**Repair target:** σ₁ (Domain Theory Crystallization) in M1-MDES

## G2 — Objective Expressibility

**What it checks:** Is "done" well-defined and measurable?

**Requirements:**
- Objective O stated as a predicate over Mod(D) — a property of the world, not a process description
- Every sort/predicate in O is declared in the domain theory's signature Σ
- `expressible_claim`: explains why O is a Σ-predicate
- Progress preorder ≼_O declared (or fixpoint objective with monotone operator)
- `well_founded`: argument that the preorder terminates
- At least one measure with: formula, range, terminal value, and proxy claim

**Common failures:**
- O is stated as a process ("run all steps") instead of a state property ("all sub-questions addressed AND no contradictions")
- O references predicates not in D (e.g., uses "Question" but Question isn't a declared sort)
- Measures lack proxy claims — the measure exists but there's no argument for why it tracks progress toward O

**Repair target:** σ₂ (Objective and Measure Declaration)

## G3 — Role Coverage and Authority

**What it checks:** Can the declared roles collectively reach the objective?

**Requirements:**
- At least one role with non-empty observation projection
- `coverage_claim`: why the union of all role observations covers the relevant state dimensions
- `authority_claim`: why the union of all role authorities covers all required transitions
- `role_partition_rationale`: why this many roles (not more, not fewer)
- No two roles with identical observation projections AND identical authority sets

**Common failures:**
- Missing coverage_claim — roles are listed but nobody says they cover everything
- Coverage claim is trivial ("covers everything") without naming what each role specifically sees
- Missing role_partition_rationale — roles exist but there's no argument for why this partition

**Repair target:** σ₃ (Role Design)

## G4 — Step DAG Composability

**What it checks:** Do the steps connect correctly from start to finish?

**Requirements:**
- At least two steps declared
- Each step has: precondition, postcondition, guidance summary, output_schema, assigned role
- Each edge has a composability claim: why post(σᵢ) ⊆ pre(σᵢ₊₁)
- `terminal_condition_claim`: why post(σ_term) ⊆ O
- `initial_condition_claim`: why pre(σ_init) holds at session start
- Step graph is **acyclic** (or uses PAT-003A for bounded loops)
- `contrarian_challenge` with: weakest_edge, challenge, defense_or_revision

**The contrarian challenge** is the most important sub-requirement. The method designer must:
1. Identify the composability claim they're least confident about
2. State why it might fail
3. Defend it (name the axiom or postcondition element that saves it) or revise it

This structural self-criticism catches implicit assumptions. If you can't name the weakest edge, you haven't thought hard enough about the DAG.

**Common failures:**
- Missing output_schema per step — guidance exists but the typed output fields aren't declared
- Missing composability claims — steps exist but nobody argues they connect
- Cyclic DAG without PAT-003A treatment — a loop with no termination argument
- Missing contrarian challenge

**Repair target:** σ₄ (Step DAG Construction)

### PAT-003A: Handling Loops

Some methods have steps that loop (M1-COUNCIL's debate loop, M2-DIMPL's Gate A patch loop). The formal theory requires acyclic DAGs, but loops are operationally necessary. PAT-003A resolves this:

A **hybrid step** is externally atomic in the DAG but internally contains a bounded convergence loop. The step has:
- An internal convergence measure ν that strictly decreases on each iteration
- A bound on ν (e.g., |Characters| × |Questions|, or max_patch_attempts per task)
- A termination argument: ν reaches 0 in finite iterations

The parent DAG sees the hybrid step as a single step. The internal dynamics are implementation detail.

## G5 — Guidance Structural Adequacy

**What it checks:** Can an agent execute each step from the guidance alone?

**Requirements:**
- Every step has finalized guidance text (not just a summary)
- Guidance follows **constraints-first format**:
  1. Constraints — what must be true after this step
  2. Rationale — why these constraints exist
  3. Procedure — steps, heuristics, checks
  4. Output schema reference — every required field named
- Every required output_schema field is explicitly named in the guidance
- No INADEQUATE step without revised guidance

**The adequacy test:** For each required output field, ask: "Does the guidance tell the agent enough to produce this field?" If the answer is no, the guidance is inadequate.

**Common failures:**
- Guidance mentions the output conceptually but doesn't name the specific fields
- Guidance follows a procedural format without leading with constraints (constraints-first is required)
- Guidance for a step with a complex output_schema only covers some fields

**Repair target:** σ₅ (Guidance Adequacy Audit)

## G6 — YAML Encoding

**What it checks:** Is the method fully encoded in its YAML file?

**Requirements:**
- All previous gates pass (G6 is meaningless without G0-G5)
- The YAML file contains all sections: navigation, domain_theory, roles, phases, composability, objective, termination, compilation_record
- The compilation_record has gate-by-gate PASS notes

This is the final structural check. If the YAML is complete and all gates pass, the method is **compiled**.

## Methodology-Adapted Gates

Methodologies (Φ = (D_Φ, δ_Φ, O_Φ)) don't have step DAGs — they have transition functions. The gates adapt:

| Gate | Method check | Methodology check |
|------|-------------|-------------------|
| G0 | Navigation | Same |
| G1 | Domain theory | Same |
| G2 | Objective | Same |
| G3 | Roles | Same |
| G4 | Step DAG composability | **Transition function + retraction pairs + termination certificate** |
| G5 | Guidance adequacy | **Predicate operationalization** (True/False criteria for driving predicates) |
| G6 | YAML encoding | Same |

The adaptation is declared in the compilation_record's `methodology_gate_adaptation` field.

## Quick Reference

| Gate | Checks | Fails → Repair |
|------|--------|----------------|
| G0 | Navigation (what/who/why/how/when) | Add navigation section |
| G1 | Domain theory (sorts, predicates, axioms, state claims) | Fix D in σ₁ |
| G2 | Objective (expressible, measurable, well-founded) | Fix O in σ₂ |
| G3 | Roles (coverage, authority, partition rationale) | Fix Roles in σ₃ |
| G4 | Step DAG (composability, contrarian challenge) | Fix Γ in σ₄ |
| G5 | Guidance (constraints-first, output field coverage) | Fix guidance in σ₅ |
| G6 | YAML encoding (structural completeness) | Fix file structure |
