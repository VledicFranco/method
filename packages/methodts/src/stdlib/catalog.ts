// SPDX-License-Identifier: Apache-2.0
/**
 * Stdlib Catalog — unified registry listing from typed definitions.
 * Replaces listMethodologiesTS() filesystem scanning.
 *
 * Metadata is extracted from the compiled YAML specs in registry/.
 * Step counts reflect the sigma_ step definitions in each method YAML.
 */

export type CatalogMethodEntry = {
  methodId: string;
  name: string;
  description: string;
  stepCount: number;
  status: "compiled" | "draft";
  version: string;
};

export type CatalogMethodologyEntry = {
  methodologyId: string;
  name: string;
  description: string;
  version: string;
  status: string;
  methods: CatalogMethodEntry[];
};

import type { Method } from "../method/method.js";
import type { Methodology } from "../methodology/methodology.js";
import { M1_MDES } from "./methods/m1-mdes.js";
import { M2_MDIS } from "./methods/m2-mdis.js";
import { M3_MEVO } from "./methods/m3-mevo.js";
import { M4_MINS } from "./methods/m4-mins.js";
import { M5_MCOM } from "./methods/m5-mcom.js";
import { M7_DTID } from "./methods/m7-dtid.js";
import { M1_COUNCIL } from "./methods/p1/m1-council.js";
import { M2_ORCH } from "./methods/p1/m2-orch.js";
import { M3_TMP } from "./methods/p1/m3-tmp.js";
import { M4_ADVREV } from "./methods/p1/m4-advrev.js";
import { M1_IMPL } from "./methods/p2/m1-impl.js";
import { M2_DIMPL } from "./methods/p2/m2-dimpl.js";
import { M3_PHRV } from "./methods/p2/m3-phrv.js";
import { M4_DDAG } from "./methods/p2/m4-ddag.js";
import { M5_PLAN } from "./methods/p2/m5-plan.js";
import { M6_ARFN } from "./methods/p2/m6-arfn.js";
import { M7_PRDS } from "./methods/p2/m7-prds.js";
import { M1_TRIAGE } from "./methods/pgh/m1-triage.js";
import { M2_REVIEW_GH } from "./methods/pgh/m2-review.js";
import { M3_RESOLVE } from "./methods/pgh/m3-resolve.js";
import { M4_WORK } from "./methods/pgh/m4-work.js";
import { M1_DRAFT } from "./methods/p3gov/m1-draft.js";
import { M2_REVIEW_GOV } from "./methods/p3gov/m2-review.js";
import { M3_APPROVE } from "./methods/p3gov/m3-approve.js";
import { M4_HANDOFF } from "./methods/p3gov/m4-handoff.js";
import { M1_INTERACTIVE } from "./methods/p3disp/m1-interactive.js";
import { M2_SEMIAUTO } from "./methods/p3disp/m2-semiauto.js";
import { M3_FULLAUTO } from "./methods/p3disp/m3-fullauto.js";
import { P0_META } from "./meta/p0-meta.js";
import { P1_EXEC } from "./methodologies/p1-exec.js";
import { P2_SD } from "./methodologies/p2-sd.js";
import { P_GH } from "./methodologies/p-gh.js";
import { P3_GOV } from "./methodologies/p3-gov.js";
import { P3_DISPATCH } from "./methodologies/p3-dispatch.js";

// ── Lookup maps ──

/** Lookup a typed Method by (methodologyId, methodId). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const METHOD_MAP: ReadonlyMap<string, Method<any>> = new Map<string, Method<any>>([
  ["P0-META/M1-MDES", M1_MDES],
  ["P0-META/M2-MDIS", M2_MDIS],
  ["P0-META/M3-MEVO", M3_MEVO],
  ["P0-META/M4-MINS", M4_MINS],
  ["P0-META/M5-MCOM", M5_MCOM],
  ["P0-META/M7-DTID", M7_DTID],
  ["P1-EXEC/M1-COUNCIL", M1_COUNCIL],
  ["P1-EXEC/M2-ORCH", M2_ORCH],
  ["P1-EXEC/M3-TMP", M3_TMP],
  ["P1-EXEC/M4-ADVREV", M4_ADVREV],
  ["P2-SD/M1-IMPL", M1_IMPL],
  ["P2-SD/M2-DIMPL", M2_DIMPL],
  ["P2-SD/M3-PHRV", M3_PHRV],
  ["P2-SD/M4-DDAG", M4_DDAG],
  ["P2-SD/M5-PLAN", M5_PLAN],
  ["P2-SD/M6-ARFN", M6_ARFN],
  ["P2-SD/M7-PRDS", M7_PRDS],
  ["P-GH/M1-TRIAGE", M1_TRIAGE],
  ["P-GH/M2-REVIEW", M2_REVIEW_GH],
  ["P-GH/M3-RESOLVE", M3_RESOLVE],
  ["P-GH/M4-WORK", M4_WORK],
  ["P3-GOV/M1-DRAFT", M1_DRAFT],
  ["P3-GOV/M2-REVIEW", M2_REVIEW_GOV],
  ["P3-GOV/M3-APPROVE", M3_APPROVE],
  ["P3-GOV/M4-HANDOFF", M4_HANDOFF],
  ["P3-DISPATCH/M1-INTERACTIVE", M1_INTERACTIVE],
  ["P3-DISPATCH/M2-SEMIAUTO", M2_SEMIAUTO],
  ["P3-DISPATCH/M3-FULLAUTO", M3_FULLAUTO],
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const METHODOLOGY_MAP: ReadonlyMap<string, Methodology<any>> = new Map<string, Methodology<any>>([
  ["P0-META", P0_META],
  ["P1-EXEC", P1_EXEC],
  ["P2-SD", P2_SD],
  ["P-GH", P_GH],
  ["P3-GOV", P3_GOV],
  ["P3-DISPATCH", P3_DISPATCH],
]);

/** Lookup a typed Method by methodology and method ID. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMethod(methodologyId: string, methodId: string): Method<any> | undefined {
  return METHOD_MAP.get(`${methodologyId}/${methodId}`);
}

/** Lookup a typed Methodology by ID. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMethodology(methodologyId: string): Methodology<any> | undefined {
  return METHODOLOGY_MAP.get(methodologyId);
}

/** Returns metadata for all 6 methodologies and their methods. */
export function getStdlibCatalog(): CatalogMethodologyEntry[] {
  return [
    {
      methodologyId: "P0-META",
      name: "Genesis Methodology for the Meta-Method Family",
      description:
        "Self-hosting meta-methodology. Designs, discovers, evolves, instantiates, " +
        "composes, and derives new methodologies. The methodology that builds methodologies.",
      version: "1.2",
      status: "compiled",
      methods: [
        {
          methodId: "M1-MDES",
          name: "Method Design Method",
          description: "Designs a new method from domain knowledge through 6 compilation gates.",
          stepCount: 7,
          status: "compiled",
          version: "1.1",
        },
        {
          methodId: "M2-MDIS",
          name: "Method Discovery Method",
          description: "Discovers informal practices and promotes them to formal methods via trial.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M3-MEVO",
          name: "Method Evolution Method",
          description: "Evolves an existing method based on gap analysis and evidence.",
          stepCount: 6,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M4-MINS",
          name: "Method Instantiation Method",
          description: "Instantiates a compiled method for a specific project context via domain morphism.",
          stepCount: 7,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M5-MCOM",
          name: "Method Composition Method",
          description: "Composes two methods into a single method with merged domain and unified roles.",
          stepCount: 7,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M7-DTID",
          name: "Domain Theory to Implementation Derivation Method",
          description: "Derives implementation artifacts from a method's domain theory.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
      ],
    },
    {
      methodologyId: "P1-EXEC",
      name: "Execution Methodology",
      description:
        "Routes user challenges to the appropriate execution method based on " +
        "adversarial pressure and decomposability predicates. 4 methods covering " +
        "debate, orchestration, sequential reasoning, and adversarial review.",
      version: "1.1",
      status: "compiled",
      methods: [
        {
          methodId: "M1-COUNCIL",
          name: "Synthetic Agents Method",
          description: "Structured multi-character debate producing decisions through adversarial structure.",
          stepCount: 4,
          status: "compiled",
          version: "1.3",
        },
        {
          methodId: "M2-ORCH",
          name: "Orchestrator Execution Method",
          description: "Single-pass parallel orchestration: decompose, dispatch sub-agents, integrate, verify.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M3-TMP",
          name: "Traditional Meta-Prompting Method",
          description: "Single-agent sequential reasoning with explicit decomposition and verification.",
          stepCount: 3,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M4-ADVREV",
          name: "Adversarial Review Pipeline Method",
          description: "Parallel contrarian advisors attack an artifact, synthesizers produce a consensus Action Plan.",
          stepCount: 7,
          status: "compiled",
          version: "0.1",
        },
      ],
    },
    {
      methodologyId: "P2-SD",
      name: "Software Delivery Methodology",
      description:
        "Routes software delivery challenges by task type to 7 methods covering " +
        "PRD sectioning, architecture refinement, planning, implementation " +
        "(single + parallel), review, and drift audit.",
      version: "2.0",
      status: "compiled",
      methods: [
        {
          methodId: "M1-IMPL",
          name: "Method for Implementing Software from Architecture and PRDs",
          description: "Two-phase implementation: Phase A raises confidence in specs, Phase B executes tasks.",
          stepCount: 9,
          status: "compiled",
          version: "3.1",
        },
        {
          methodId: "M2-DIMPL",
          name: "Distributed Implementation Method",
          description: "Re-entrant parallel orchestration with Gate A (quality) and Gate B (security/architecture).",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M3-PHRV",
          name: "Phase Review Method",
          description: "Post-implementation review producing a ReviewReport with per-finding file:line citations.",
          stepCount: 4,
          status: "compiled",
          version: "1.1",
        },
        {
          methodId: "M4-DDAG",
          name: "Drift Audit Method",
          description: "Cross-phase drift detection analyzing N recent phases for architectural divergence.",
          stepCount: 4,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M5-PLAN",
          name: "Phase Planning Method",
          description: "Takes a PRDSection and produces a PhaseDoc — scoped, severity-rated task list.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M6-ARFN",
          name: "Architecture Refinement Method",
          description: "Produces or updates ArchDoc files following the horizontal documentation pattern.",
          stepCount: 4,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M7-PRDS",
          name: "PRD Sectioning Method",
          description: "Decomposes a full PRD into plannable PRDSections with dependency ordering.",
          stepCount: 3,
          status: "compiled",
          version: "1.0",
        },
      ],
    },
    {
      methodologyId: "P-GH",
      name: "GitHub Operations Methodology",
      description:
        "Routes GitHub operations challenges by entity type and action to 4 methods " +
        "covering issue triage, PR review with self-fix, merge conflict resolution, " +
        "and full issue-to-PR work execution.",
      version: "1.0",
      status: "compiled",
      methods: [
        {
          methodId: "M1-TRIAGE",
          name: "Issue Triage Method",
          description: "Reads a GitHub issue, classifies by type and scope, routes to action (commission, PRD, escalate, close).",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M2-REVIEW",
          name: "PR Review with Self-Fix Method",
          description: "Reviews a PR with file:line citations, enters bounded self-fix loop on needs_changes.",
          stepCount: 6,
          status: "compiled",
          version: "1.1",
        },
        {
          methodId: "M3-RESOLVE",
          name: "Merge Conflict Resolution Method",
          description: "Detects, classifies (mechanical/semantic), resolves, and verifies merge conflicts.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M4-WORK",
          name: "Issue Work Execution Method",
          description: "Full git lifecycle from issue to merged PR: branch, implement, commit, PR, self-review.",
          stepCount: 9,
          status: "compiled",
          version: "1.0",
        },
      ],
    },
    {
      methodologyId: "P3-GOV",
      name: "Governance Methodology",
      description:
        "Pipeline methodology tracking RFC lifecycle through governance review stages. " +
        "Receives identified gaps, produces human-approved commissions. Two output classes: " +
        "internal decisions (automated) and RFCs (require human approval).",
      version: "0.1",
      status: "draft",
      methods: [
        {
          methodId: "M1-DRAFT",
          name: "RFC Drafting Method",
          description: "Receives a gap description and produces a well-formed RFC per RFC-SCHEMA.",
          stepCount: 3,
          status: "draft",
          version: "0.1",
        },
        {
          methodId: "M2-REVIEW",
          name: "Council Review Method",
          description: "Receives an RFC and produces a review verdict, delegating debate to M1-COUNCIL.",
          stepCount: 4,
          status: "draft",
          version: "0.2",
        },
        {
          methodId: "M3-APPROVE",
          name: "Human Approval Method",
          description: "Presents governance-approved RFC to human PO, records approve/reject/request_changes.",
          stepCount: 3,
          status: "draft",
          version: "0.1",
        },
        {
          methodId: "M4-HANDOFF",
          name: "Commission Handoff Method",
          description: "Generates actionable commission from human-approved RFC with governance traceability.",
          stepCount: 3,
          status: "draft",
          version: "0.1",
        },
      ],
    },
    {
      methodologyId: "P3-DISPATCH",
      name: "Dispatch Methodology",
      description:
        "Autonomy-aware orchestration of methodology execution. Routes to one of three " +
        "dispatch methods based on human-specified autonomy mode: INTERACTIVE, SEMIAUTO, " +
        "or FULLAUTO.",
      version: "1.0",
      status: "compiled",
      methods: [
        {
          methodId: "M1-INTERACTIVE",
          name: "Human-in-the-Loop Dispatch Method",
          description: "Interactive dispatch where human confirms every decision point.",
          stepCount: 5,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M2-SEMIAUTO",
          name: "Selective Escalation Dispatch Method",
          description: "Semi-autonomous dispatch: auto-advance on clear cases, escalate on ambiguity/failure.",
          stepCount: 6,
          status: "compiled",
          version: "1.0",
        },
        {
          methodId: "M3-FULLAUTO",
          name: "Unattended Dispatch Method",
          description: "Fully autonomous dispatch with retry budget. Human notified on completion or hard failure.",
          stepCount: 6,
          status: "compiled",
          version: "1.0",
        },
      ],
    },
  ];
}
