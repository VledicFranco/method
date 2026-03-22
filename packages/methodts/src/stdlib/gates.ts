/**
 * Compilation gates G1-G6 for M1-MDES.
 *
 * These are the typed Gate<DesignState> values that correspond to
 * the six compilation gates from the method registry system.
 * Each gate wraps a Predicate<DesignState> via scriptGate.
 */

import { scriptGate } from "../gate/runners/script-gate.js";
import { check } from "../predicate/predicate.js";
import type { Gate } from "../gate/gate.js";
import type { DesignState } from "./types.js";

/** G1: Domain signature + axiom validation. */
export const G1_domain: Gate<DesignState> = scriptGate<DesignState>(
  "G1-domain",
  "Domain theory signature and axioms valid",
  check("G1", (s) => s.candidateComponents.includes("DomainTheory")),
);

/** G2: Objective expressible as a typed predicate. */
export const G2_objective: Gate<DesignState> = scriptGate<DesignState>(
  "G2-objective",
  "Objective is an expressible predicate",
  check("G2", (s) => s.candidateComponents.includes("Objective")),
);

/** G3: Role coverage — all step roles have definitions. */
export const G3_roles: Gate<DesignState> = scriptGate<DesignState>(
  "G3-roles",
  "All step roles have definitions",
  check("G3", (s) => s.candidateComponents.includes("Roles")),
);

/** G4: DAG acyclicity + edge composability. */
export const G4_dag: Gate<DesignState> = scriptGate<DesignState>(
  "G4-dag",
  "Step DAG is acyclic and edges are composable",
  check("G4", (s) => s.candidateComponents.includes("StepDAG")),
);

/** G5: Guidance finalized — all agent steps have reviewed guidance. */
export const G5_guidance: Gate<DesignState> = scriptGate<DesignState>(
  "G5-guidance",
  "All agent steps have finalized guidance",
  check("G5", (s) => s.guidanceFinalized),
);

/** G6: Serializable — method structure survives JSON round-trip. */
export const G6_serializable: Gate<DesignState> = scriptGate<DesignState>(
  "G6-serializable",
  "Method structure is serializable",
  check("G6", (s) => {
    try {
      JSON.stringify(s);
      return true;
    } catch {
      return false;
    }
  }),
);

/** All compilation gates in order. */
export const compilationGates: Gate<DesignState>[] = [
  G1_domain,
  G2_objective,
  G3_roles,
  G4_dag,
  G5_guidance,
  G6_serializable,
];
