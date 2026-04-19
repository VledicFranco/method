// SPDX-License-Identifier: Apache-2.0
/**
 * Metadata barrel — re-exports all narrative metadata for stdlib methods and methodologies.
 */

export type { MethodMetadata, MethodologyMetadata, MethodNavigation, CompilationRecord, CompilationGate, KnownWipItem } from "../metadata-types.js";

// P0-META
export { P0_META_META, M1_MDES_META, M2_MDIS_META, M3_MEVO_META, M4_MINS_META, M5_MCOM_META, M7_DTID_META } from "./p0-meta.js";

// P1-EXEC
export { P1_EXEC_META, M1_COUNCIL_META, M2_ORCH_META, M3_TMP_META, M4_ADVREV_META } from "./p1-exec.js";

// P2-SD
export { P2_SD_META, M1_IMPL_META, M2_DIMPL_META, M3_PHRV_META, M4_DDAG_META, M5_PLAN_META, M6_ARFN_META, M7_PRDS_META } from "./p2-sd.js";

// P-GH
export { P_GH_META, M1_TRIAGE_META, M2_REVIEW_GH_META, M3_RESOLVE_META, M4_WORK_META } from "./p-gh.js";

// P3-GOV
export { P3_GOV_META, M1_DRAFT_META, M2_REVIEW_GOV_META, M3_APPROVE_META, M4_HANDOFF_META } from "./p3-gov.js";

// P3-DISPATCH
export { P3_DISPATCH_META, M1_INTERACTIVE_META, M2_SEMIAUTO_META, M3_FULLAUTO_META } from "./p3-dispatch.js";

// ── Lookup maps ──

import type { MethodMetadata, MethodologyMetadata } from "../metadata-types.js";
import { P0_META_META, M1_MDES_META, M2_MDIS_META, M3_MEVO_META, M4_MINS_META, M5_MCOM_META, M7_DTID_META } from "./p0-meta.js";
import { P1_EXEC_META, M1_COUNCIL_META, M2_ORCH_META, M3_TMP_META, M4_ADVREV_META } from "./p1-exec.js";
import { P2_SD_META, M1_IMPL_META, M2_DIMPL_META, M3_PHRV_META, M4_DDAG_META, M5_PLAN_META, M6_ARFN_META, M7_PRDS_META } from "./p2-sd.js";
import { P_GH_META, M1_TRIAGE_META, M2_REVIEW_GH_META, M3_RESOLVE_META, M4_WORK_META } from "./p-gh.js";
import { P3_GOV_META, M1_DRAFT_META, M2_REVIEW_GOV_META, M3_APPROVE_META, M4_HANDOFF_META } from "./p3-gov.js";
import { P3_DISPATCH_META, M1_INTERACTIVE_META, M2_SEMIAUTO_META, M3_FULLAUTO_META } from "./p3-dispatch.js";

const METHOD_METADATA_MAP = new Map<string, MethodMetadata>([
  ["P0-META/M1-MDES", M1_MDES_META],
  ["P0-META/M2-MDIS", M2_MDIS_META],
  ["P0-META/M3-MEVO", M3_MEVO_META],
  ["P0-META/M4-MINS", M4_MINS_META],
  ["P0-META/M5-MCOM", M5_MCOM_META],
  ["P0-META/M7-DTID", M7_DTID_META],
  ["P1-EXEC/M1-COUNCIL", M1_COUNCIL_META],
  ["P1-EXEC/M2-ORCH", M2_ORCH_META],
  ["P1-EXEC/M3-TMP", M3_TMP_META],
  ["P1-EXEC/M4-ADVREV", M4_ADVREV_META],
  ["P2-SD/M1-IMPL", M1_IMPL_META],
  ["P2-SD/M2-DIMPL", M2_DIMPL_META],
  ["P2-SD/M3-PHRV", M3_PHRV_META],
  ["P2-SD/M4-DDAG", M4_DDAG_META],
  ["P2-SD/M5-PLAN", M5_PLAN_META],
  ["P2-SD/M6-ARFN", M6_ARFN_META],
  ["P2-SD/M7-PRDS", M7_PRDS_META],
  ["P-GH/M1-TRIAGE", M1_TRIAGE_META],
  ["P-GH/M2-REVIEW", M2_REVIEW_GH_META],
  ["P-GH/M3-RESOLVE", M3_RESOLVE_META],
  ["P-GH/M4-WORK", M4_WORK_META],
  ["P3-GOV/M1-DRAFT", M1_DRAFT_META],
  ["P3-GOV/M2-REVIEW", M2_REVIEW_GOV_META],
  ["P3-GOV/M3-APPROVE", M3_APPROVE_META],
  ["P3-GOV/M4-HANDOFF", M4_HANDOFF_META],
  ["P3-DISPATCH/M1-INTERACTIVE", M1_INTERACTIVE_META],
  ["P3-DISPATCH/M2-SEMIAUTO", M2_SEMIAUTO_META],
  ["P3-DISPATCH/M3-FULLAUTO", M3_FULLAUTO_META],
]);

const METHODOLOGY_METADATA_MAP = new Map<string, MethodologyMetadata>([
  ["P0-META", P0_META_META],
  ["P1-EXEC", P1_EXEC_META],
  ["P2-SD", P2_SD_META],
  ["P-GH", P_GH_META],
  ["P3-GOV", P3_GOV_META],
  ["P3-DISPATCH", P3_DISPATCH_META],
]);

/** Lookup narrative metadata for a method. */
export function getMethodMetadata(methodologyId: string, methodId: string): MethodMetadata | undefined {
  return METHOD_METADATA_MAP.get(`${methodologyId}/${methodId}`);
}

/** Lookup narrative metadata for a methodology. */
export function getMethodologyMetadata(methodologyId: string): MethodologyMetadata | undefined {
  return METHODOLOGY_METADATA_MAP.get(methodologyId);
}

/** Get all method metadata entries. */
export function getAllMethodMetadata(): ReadonlyMap<string, MethodMetadata> {
  return METHOD_METADATA_MAP;
}

/** Get all methodology metadata entries. */
export function getAllMethodologyMetadata(): ReadonlyMap<string, MethodologyMetadata> {
  return METHODOLOGY_METADATA_MAP;
}
