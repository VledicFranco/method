// SPDX-License-Identifier: Apache-2.0
/**
 * Narrative metadata types for stdlib methods and methodologies.
 *
 * Carries the documentation, navigation, compilation records, and WIP items
 * that complement the typed execution definitions. These are extracted from
 * the compiled YAML specs in registry/ and serve the bridge registry UI.
 */

export interface MethodNavigation {
  readonly what: string;
  readonly who: string;
  readonly why: string;
  readonly how: string;
  readonly when_to_use?: readonly string[];
  readonly when_to_invoke?: readonly string[];
  readonly when_not_to_use?: readonly string[];
  readonly when_not_to_invoke?: readonly string[];
}

export interface CompilationGate {
  readonly gate: string;
  readonly result: "PASS" | "FAIL" | "SKIP";
  readonly note?: string;
}

export interface CompilationRecord {
  readonly gates: readonly CompilationGate[];
}

export interface KnownWipItem {
  readonly id: string;
  readonly status: string;
  readonly description?: string;
  readonly evidence?: string;
  readonly council_decisions?: readonly string[];
}

/** Full narrative metadata for a method. */
export interface MethodMetadata {
  readonly id: string;
  readonly parent: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: "compiled" | "draft" | "trial";
  readonly compilation_date?: string;
  readonly evolution_note?: string;
  readonly formal_grounding?: string;
  readonly navigation: MethodNavigation;
  readonly compilation_record?: CompilationRecord;
  readonly known_wip?: readonly KnownWipItem[];
}

/** Full narrative metadata for a methodology. */
export interface MethodologyMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: "compiled" | "draft";
  readonly compilation_date?: string;
  readonly niche?: string;
  readonly navigation: MethodNavigation;
  readonly compilation_record?: CompilationRecord;
  readonly known_wip?: readonly KnownWipItem[];
}
