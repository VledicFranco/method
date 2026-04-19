// SPDX-License-Identifier: Apache-2.0
import type {
  MethodologyMetadata,
  MethodMetadata,
} from "../metadata-types.js";

export const P0_META_META: MethodologyMetadata = {
  id: "P0-META",
  name: "Genesis Methodology for the Meta-Method Family",
  description: `Phi = (D_Phi, delta_Phi, O_Phi)`,
  version: "1.2",
  status: "compiled",
  compilation_date: "2026-03-14",
  navigation: {
    what: `P0-META receives a target registry of methods, evaluates delta_META to select the appropriate meta-method (M1-MDES through M7-DTID), runs that method to completion, and repeats until all in-scope methods are compiled_clean and all meta-family methods are self-consistent.`,
    who: `One role — the meta-architect. Strategic role that evaluates delta_META, dispatches meta-methods, receives results, and updates registry state. Holds full D_META observability.`,
    why: `Methods must be designed, discovered, evolved, instantiated, composed, audited, and derived. Without a methodology coordinating these meta-methods, the order of operations is ad-hoc. P0-META externalizes the coordination logic into delta_META.`,
    how: `Evaluate delta_META priority stack: gap severity first (M3-MEVO), then lifecycle design (M1-MDES), instantiation (M4-MINS), composition (M5-MCOM), audit (M6-MAUD), derivation (M7-DTID), discovery (M2-MDIS). First arm that fires selects the method. Terminate when O_META satisfied or no arm fires.`,
  },
  known_wip: [
    {
      id: "M2-MDIS",
      status: "compiled",
      description: `Compiled 2026-03-14. Protocol lifecycle as step DAG. Validated by RETRO-PROTO (full lifecycle) and STEER-PROTO (draft stage).`,
    },
    {
      id: "nu_META_weights",
      status: "open",
      description: `W_method and W_gap have no calibrated values; first empirical runs will calibrate`,
    },
    {
      id: "nu_META_M4_M7_decrease",
      status: "open",
      description: `Arms M4-MINS and M7-DTID clear their firing conditions but do not directly decrease nu_META's numeric value. Formal termination argument requires showing these arms cannot re-fire without another arm having already strictly decreased nu_META.`,
    },
    {
      id: "D_MAUD_declaration",
      status: "open",
      description: `M6-MAUD's domain theory D_MAUD is referenced in RP-5 but not formally declared. Requires M6-MAUD compile pass to produce D_MAUD specification. Blocks formal verification of RP-5 retraction condition.`,
    },
  ],
};

export const M1_MDES_META: MethodMetadata = {
  id: "M1-MDES",
  parent: "P0-META",
  name: "Method Design from Established Domain Knowledge",
  description: `Crystallizes established domain knowledge into a formally validated method — the full 5-tuple M = (D, Roles, \u0393, O, \u03BC\u20D7). Produces a method document and a YAML encoding ready to load into the method server. The method compiles when it passes all seven acceptance gates (G0\u2013G6) at \u03C3\u2086.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M1-MDES crystallizes established domain knowledge into a formally validated method M = (D, Roles, \u0393, O, \u03BC\u20D7). Produces a method document and YAML encoding. Compiles when all seven acceptance gates (G0\u2013G6) pass at \u03C3\u2086.`,
    who: `Two implicit roles — the designer (assembles the method candidate through \u03C3\u2080\u2013\u03C3\u2085) and the compiler (\u03C3\u2086 gate evaluation). In practice, a single agent occupies both roles sequentially.`,
    why: `Domain knowledge that remains informal cannot be composed, instantiated, evolved, or audited. M1-MDES is the entry point for formalizing any domain into the method system.`,
    how: `Seven steps: \u03C3\u2080 (sufficiency assessment) \u2192 \u03C3\u2081 (domain theory) \u2192 \u03C3\u2082 (objective and measures) \u2192 \u03C3\u2083 (roles) \u2192 \u03C3\u2084 (step DAG) \u2192 \u03C3\u2085 (guidance finalization) \u2192 \u03C3\u2086 (compilation check against G0\u2013G6).`,
  },
};

export const M2_MDIS_META: MethodMetadata = {
  id: "M2-MDIS",
  parent: "P0-META",
  name: "Method Discovery from Informal Practice",
  description: `Takes an observed informal practice \u2014 a recurring pattern identified from retrospective signals, council debates, cross-project examination, or human intuition \u2014 and structures it through the protocol lifecycle: recognize, draft, trial, evaluate, promote. Produces either a compiled method (via M1-MDES), a promoted axiom, or an archived learning. Completes delta_META arm 7.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M2-MDIS takes an observed informal practice and produces a validated outcome: a compiled method, a promoted protocol/axiom, or an archived finding. It does NOT produce the observation \u2014 the creative act of recognizing a practice happens outside M2-MDIS (from retro signals, councils, or intuition). M2-MDIS structures what comes AFTER recognition: drafting, trialing, evaluating, and promoting.`,
    who: `One role \u2014 the discoverer. The meta-architect or any agent who has observed a recurring informal practice and wants to formalize it. In practice, the discoverer is often the human reviewing accumulated retrospective signals.`,
    why: `Methods are static after compilation. New methods require domain knowledge that doesn't exist yet \u2014 it emerges from execution. Without M2-MDIS, the gap between "we keep doing this informally" and "this is a compiled method" is crossed by ad-hoc judgment. M2-MDIS makes the crossing structured and evidence-based.`,
    how: `Five linear steps: recognize (validate the observation) \u2192 draft (write protocol YAML) \u2192 trial (enforce on one project/methodology, collect data) \u2192 evaluate (check promotion criteria) \u2192 promote (formalize or archive).`,
    when_to_use: [
      "A practice recurs across 3+ sessions and produces identifiable artifacts",
      "A retrospective observation has reached gap candidate threshold",
      "A project has invented a process that other projects would benefit from",
      "A council session identifies a governance or process gap",
    ],
    when_not_to_use: [
      "The domain knowledge is already established \u2014 use M1-MDES directly",
      "The practice is project-specific \u2014 add it as a delivery rule in the project card",
      "The practice is a one-off \u2014 just do it, don't formalize",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: structure informal practice through protocol lifecycle. Who: discoverer. Why: bridge gap between informal practice and compiled method. How: 5-step linear DAG. When: recurring practice with artifacts, not one-off or project-specific.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_MDIS = (Sigma_MDIS, Ax_MDIS). 6 sorts, 3 function symbols, 8 predicates, 5 closed axioms encoding lifecycle ordering. Domain boundary stated. State claims verified axiom-by-axiom.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_MDIS as conjunction of promotion_decided + artifact_produced. Terminal type. 5-stage total chain preorder. 1 measure (lifecycle progress).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `1 role (discoverer), identity projection, all 5 steps authorized. Role partition: one role because evaluation is against measurable criteria.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `5 steps in path graph. Composability claims for all 4 edges. sigma_2->sigma_3 edge has elapsed time between steps (trial runs asynchronously). Contrarian challenge on sigma_3->sigma_4: generalization concern, defended by self-correcting property.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All 5 steps have constraints-first guidance naming all output_schema fields. sigma_0 sufficiency test is a 4-question heuristic (same pattern as M1-MDES sigma_0).`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P0-META/M2-MDIS/M2-MDIS.yaml). Structurally complete.`,
      },
    ],
  },
};

export const M3_MEVO_META: MethodMetadata = {
  id: "M3-MEVO",
  parent: "P0-META",
  name: "Method for Evolving Deployed Methods from Execution Evidence",
  description: `Takes a deployed method M.X version N with accumulated execution evidence and produces M.X version N+1 \u2014 an evolved method with a change manifest and a refinement claim per Definition 8.2 (F1-FTH). The method compiles when the evolved candidate passes all seven acceptance gates (G0\u2013G6) at \u03C3\u2085 and each changed step carries a structurally complete refinement claim. This is the third method in the meta-methods family (M1-MDES\u2013M.00N).`,
  version: "0.1",
  status: "compiled",
  compilation_date: "2026-03-09",
  formal_grounding: "theory/F1-FTH.md \u00A78.4, Definition 8.2",
  navigation: {
    what: `M3-MEVO takes a deployed method M.X vN with execution evidence and produces M.X vN+1 with a change manifest and refinement claims. Compiles when all gates pass and each changed step has a structurally complete refinement claim.`,
    who: `Three roles \u2014 analyst (\u03C3\u2080\u2013\u03C3\u2081, crystallizes gap records from evidence), evolver (\u03C3\u2082\u2013\u03C3\u2084, designs changes and refinement claims), compiler (\u03C3\u2085, gate evaluation).`,
    why: `Definition 8.2 requires refinement claims for method evolution. Without M3-MEVO, methods evolve informally without traceability from execution evidence to design changes to formal refinement.`,
    how: `Six steps: \u03C3\u2080 (evidence intake) \u2192 \u03C3\u2081 (gap crystallization) \u2192 \u03C3\u2082 (version boundary determination) \u2192 \u03C3\u2083 (change design) \u2192 \u03C3\u2084 (assembly) \u2192 \u03C3\u2085 (compilation check). Branch at \u03C3\u2082: if new-method needed, exit to M1-MDES.`,
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: change manifest + refinement claim + evolved method M.X vN+1. Who: three roles \u2014 analyst (sigma_0-sigma_1), evolver (sigma_2-sigma_4), compiler (sigma_5). Why: Definition 8.2 gap; M1-IMPL version history (v1.0 to v2.1) as canonical example of evolution without formal refinement claims. How: linear sigma_0 through sigma_5 DAG with new-method branch at sigma_2. When: deployed M.X vN with execution history, at least one gap candidate appearing across 3 or more sessions, and continuity requirement (must remain M.X).`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_MEVO = (Sigma_MEVO, Ax_MEVO). 11 sorts declared: Method, DomainTheory, ExecutionEvidence, SessionLog, GateFailureRecord, GapRecord, VersionBoundary, ChangeManifest, RefinementClaim, ConservativeExtension, CompilationResult. 7 predicates typed over declared sorts: has_sufficient_evidence, conservative_extension, axiom_revised, closes_gap, preserves_initial_states, no_new_composability_failures, refines. All 8 axioms are closed sentences \u2014 no free variables. No undefined sort references.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_MEVO expressible over Sigma_MEVO as conjunction of six conditions, all referencing declared sorts (GapRecord, VersionBoundary, ChangeManifest, RefinementClaim, CompilationResult). Progress preorder declared as lexicographic ordering on (mu_1, mu_2, mu_3) with rationale. Three measures declared: mu_1 (gap coverage), mu_2 (refinement claim completeness), mu_3 (compilation passage rate), each with formula and range [0.0, 1.0]. Session delta formula declared. Well-founded: each measure bounded and decreasing under correct execution.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Three roles with non-empty observation projections and authority claims. Analyst observes ExecutionEvidence and M.X vN step specifications; authorized to emit GapRecords, discard single-session failures; explicitly CANNOT design fixes. Evolver observes M.X vN + GapRecord set + F1-FTH; authorized to declare VersionBoundary and design changes; CANNOT revise gap records. Compiler observes candidate + F1-FTH only; authorized to emit PASS or FAIL. Coverage claim: union covers all of Mod(D_MEVO). Authority claim: union covers all transitions required for O_MEVO. Role partition rationale documented in section 2.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Gamma_MEVO is a linear DAG (sigma_0 through sigma_5) with a branch at sigma_2 (new-method path exits the method; routes to M1-MDES). Composability claims at all five edges documented in section 6, each showing post_{sigma_i} satisfies pre_{sigma_j}. Terminal condition claim: post_{sigma_5}(PASS) implies O_MEVO. Initial condition claim: pre_{sigma_0} satisfied by any deployed M.X vN with at least 1 session in execution history. Contrarian challenge documented: weakest edge is sigma_4 to sigma_5 (self-reported assembly_confirmation); defense is that G5 at sigma_5 catches guidance-schema mismatches that superficial confirmation would miss. Termination certificate nu_MEVO declared in section 8.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All six steps (sigma_0 through sigma_5) have finalized guidance text. All steps lead with a Constraints block before any Guidance or Procedure text \u2014 constraints-first format satisfied throughout. The insight-preservation constraint added to sigma_4 is integrated into the existing Constraints block, not replacing or weakening any prior constraint. No step has INADEQUATE or placeholder guidance. Adequacy: each Constraints block names specific checkable conditions; guidance provides decision procedures for each constraint.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (M3-MEVO/M3-MEVO.yaml). Structurally complete: all 6 phases declared with id, name, role, precondition, postcondition, guidance, output_schema, and invariants. Roles section complete with phases arrays. Domain theory section declares all 11 sorts, 7 predicates, and 8 axioms. Measures and objective declared. insight_preservation_check field added to sigma_4 output_schema with hard invariants. compilation_record section added with all 7 gates. No undefined variable references.`,
      },
    ],
  },
};

export const M4_MINS_META: MethodMetadata = {
  id: "M4-MINS",
  parent: "P0-META",
  name: "Method for Instantiating a General Method into a Project Instance",
  description: `Takes a validated (compiled) general method M.X and a specific project context and produces a project instance P.X.Y \u2014 specialized step guidance, role files with project-specific observation projections, and a formal domain morphism declaration grounded in the domain retraction of F1-FTH \u00A76.3. The method compiles when P.X.Y passes all seven acceptance gates (G0\u2013G6) at \u03C3\u2086 and constitutes an independently executable method for the target project. This is the fourth method in the meta-methods family (M1-MDES\u2013M.00N).`,
  version: "1.2",
  status: "compiled",
  compilation_date: "2026-03-10",
  evolution_note: `v1.1 evolution (MINS-MEVO-001, 2026-03-10, SESSION-009): \u03C3\u2083.0 (Constraint Derivation, mechanical) added to \u03C3\u2083; \u03C3\u2084 decomposed into \u03C3\u2084.0 (Observation Projection Derivation, mechanical) + \u03C3\u2084.1 (Role File Rendering, judgment). G2 gate strengthened: derived_projections consistency now a compilation FAIL condition. Refinement claim: v1.1 refines_SP v1.0. v1.2: evolution_date 2026-03-14.`,
  formal_grounding: "theory/F1-FTH.md \u00A76.3, \u00A71.4, \u00A72",
  navigation: {
    what: `M4-MINS takes a compiled general method M.X and a project context and produces a project instance P.X.Y with specialized step guidance, role files, a formal domain morphism declaration, and version coupling.`,
    who: `A single agent occupying the instantiator role throughout all steps.`,
    why: `General methods are project-agnostic. Without instantiation, project-specific guidance, observation projections, and domain extensions remain informal. M4-MINS produces formally traceable project instances grounded in F1-FTH \u00A76.3 domain retraction.`,
    how: `Seven steps: \u03C3\u2080 (sufficiency assessment) \u2192 \u03C3\u2081 (domain extension) \u2192 \u03C3\u2082 (domain morphism) \u2192 \u03C3\u2083 (step specialization with constraint derivation) \u2192 \u03C3\u2084 (role file rendering with observation projection derivation) \u2192 \u03C3\u2085 (version coupling) \u2192 \u03C3\u2086 (compilation check).`,
  },
};

export const M5_MCOM_META: MethodMetadata = {
  id: "M5-MCOM",
  parent: "P0-META",
  name: "Method for Composing Two Compiled Methods Sequentially",
  description: `Takes two validated (compiled) methods M and M' whose domains share an interface sub-signature Sigma_I and produces a composite method M'' = M ; M' \u2014 a first-class compiled method with its own domain theory D'', step DAG Gamma'', role set Roles'', objective O'', and YAML encoding. M'' is independently loadable, compilable, and evolvable. This is the fifth method in the meta-methods family (M1-MDES\u2013M5-MCOM), implementing horizontal composition of 1-cells in the 2-category Meth.`,
  version: "1.1",
  status: "compiled",
  compilation_date: "2026-03-10",
  formal_grounding: "theory/F1-FTH.md \u00A74, \u00A76.3, \u00A78.5; theory/F5-MCOM.md",
  navigation: {
    what: `M5-MCOM takes two compiled methods M and M' with a shared interface sub-signature Sigma_I and produces a composite method M'' = M ; M' as a first-class compiled method.`,
    who: `A single agent occupying the composer role, executing \u03C3\u2080 through \u03C3\u2086.`,
    why: `Method composition extends the method family's algebraic structure. Without formal composition, combining methods is ad-hoc and the composite lacks its own compilation, evolution, and instantiation identity.`,
    how: `Seven steps: \u03C3\u2080 (input validation) \u2192 \u03C3\u2081 (interface identification) \u2192 \u03C3\u2082 (domain construction) \u2192 \u03C3\u2083 (DAG assembly) \u2192 \u03C3\u2084 (role merge) \u2192 \u03C3\u2085 (objective and termination) \u2192 \u03C3\u2086 (compilation check).`,
  },
};

export const M7_DTID_META: MethodMetadata = {
  id: "M7-DTID",
  parent: "P0-META",
  name: "Domain Theory to Implementation Derivation",
  description: `Takes a compiled domain theory D = (\u03A3, Ax) and produces an Implementation Decision Document (IDD) \u2014 a structured record mapping every \u03A3-element and axiom to a forced implementation choice (via the derivation taxonomy) or a documented free choice (where the theory under-determines the implementation). Addresses open problem P6 (theory-implementation faithfulness). The IDD is faithful(idd, D) iff every axiom in Ax is covered by at least one forced or free choice entry.`,
  version: "1.1",
  status: "compiled",
  compilation_date: "2026-03-10",
  evolution_note: `v1.1 compliance repair (2026-03-14): declared idd_of: DomainTheory -> IDD function symbol (used in objective but undeclared \u2014 G1/G2 violation); added method: root wrapper; renamed domain: -> domain_theory:; expanded sorts with cardinality and description; formalized axiom statements (gloss: -> statement:); added nat sort; added termination_certificate; added family block; added output_artifacts; renamed composability: -> composability_claim: in step_dag edges.`,
  formal_grounding: "theory/F1-FTH.md \u00A71, \u00A76",
  navigation: {
    what: `M7-DTID takes a compiled domain theory D = (\u03A3, Ax) and produces an Implementation Decision Document (IDD) mapping every \u03A3-element and axiom to forced or free implementation choices. Output satisfies faithful(idd_of(D), D).`,
    who: `Four roles \u2014 Domain Reader (\u03C1_DR, enumerates \u03A3-elements and axioms), Derivation Analyst (\u03C1_DA, applies taxonomy to produce forced choices), Gap Analyst (\u03C1_GA, addresses free choices), IDD Compiler (\u03C1_IC, verifies faithfulness and assembles document).`,
    why: `Open problem P6: theory-implementation faithfulness. Without M7-DTID, the mapping from domain theory to implementation is undocumented. Forced choices are invisible and free choices are untracked.`,
    how: `Five-step diamond DAG: \u03C3_A1 (theory intake) \u2192 {\u03C3_A2 (derivation pass) \u2225 \u03C3_A3 (gap pass)} \u2192 \u03C3_A4 (faithfulness check) \u2192 \u03C3_A5 (IDD assembly). \u03C3_A2 and \u03C3_A3 execute in parallel.`,
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `SESSION-010. Navigability complete: What (IDD artifact), Who (4 roles), Why (P6 faithfulness gap), How (5-step diamond DAG), When (compiled domain theory at stable draft).`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_DTID: 8 sorts (DomainTheory, \u03A3Element, Axiom, DerivationRule, ForcedChoice, FreeChoice, IDD, nat), 5 function symbols (idd_of, source, rule_applied, forced_table, free_table), 3 predicates (covers, documented, faithful), 4 axioms. v1.1: idd_of declared to resolve undeclared function symbol in objective.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `Objective faithful(idd_of(D),D) AND forall fc. documented(fc) expressible over D_DTID. Both symbols declared in v1.1. Progress preorder lexicographic on (\u03BC\u2081, \u03BC\u2082). Two measures with formulas and ranges.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Four roles with non-empty observation projections and authority claims. \u03C1_DR (enumeration), \u03C1_DA (forced choices), \u03C1_GA (free choices), \u03C1_IC (faithfulness + assembly). Coverage: union covers all D_DTID predicates. Authority: union covers all transitions needed for O_DTID.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Diamond DAG: \u03C3_A1 \u2192 {\u03C3_A2 \u2225 \u03C3_A3} \u2192 \u03C3_A4 \u2192 \u03C3_A5. Acyclic. 5 edges with composability claims. Parallel branches declared (\u03C3_A2 and \u03C3_A3 both depend on \u03C3_A1, both feed \u03C3_A4). Contrarian challenge: \u03C3_A1 enumeration completeness is weakest, not \u03C3_A4.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All 5 steps have guidance via role descriptions and step preconditions/postconditions. Derivation taxonomy provides procedure for \u03C3_A2. Gap pass procedure implicit in \u03C1_GA authority. Constraints-first format in role descriptions.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `YAML encodable: method: wrapper, domain_theory: block, roles: with phases arrays, step_dag: with edges and parallel_branches, output_artifacts:, family:. All sorts, functions, predicates declared. v1.1 structural alignment complete.`,
      },
    ],
  },
};
