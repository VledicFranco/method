/**
 * TLA+ compilation — transforms Methodology<S> into TLA+ specification modules.
 *
 * Mapping:
 * - WorldState fields -> TLA+ state variables
 * - Domain axioms -> TLA+ invariants (box(axiom))
 * - Methodology arms -> Next-state relation (disjunction of arm actions)
 * - Objective -> Liveness property (diamond(objective))
 * - SafetyBounds -> Bounded execution invariant
 *
 * TLA+ output is best-effort: `check` predicates produce comments since
 * opaque TypeScript functions cannot be compiled to TLA+ expressions.
 */

import type { Methodology } from "../methodology/methodology.js";
import type { Predicate } from "../predicate/predicate.js";
import type { TLAModule, TLAVariable, TLAPredicate, TLAProperty } from "./ast.js";

/**
 * Compile a methodology to a TLA+ specification module.
 */
export function compileToTLA<S>(
  methodology: Methodology<S>,
  stateFields: readonly string[],
): TLAModule {
  const name = sanitizeName(methodology.id);

  // Variables from state fields
  const variables: TLAVariable[] = stateFields.map(f => ({
    name: f,
    type: "untyped",
  }));

  // Add execution tracking variables
  variables.push(
    { name: "loop_count", type: "Nat" },
    { name: "current_method", type: 'MethodId \\union {"none"}' },
    { name: "status", type: '{"running", "completed", "violated"}' },
  );

  // Init predicate
  const init: TLAPredicate = {
    name: "Init",
    body: [
      ...stateFields.map(f => `${f} = ${f}_init`),
      "loop_count = 0",
      'current_method = "none"',
      'status = "running"',
    ].join(" /\\ "),
  };

  // Arm action definitions (helper predicates for each arm)
  const definitions: TLAPredicate[] = [];
  const armActionNames: string[] = [];

  for (const arm of methodology.arms) {
    const actionName = `Arm_${sanitizeName(arm.label)}`;
    armActionNames.push(actionName);

    const condition = predicateToTLA(arm.condition);
    const selects = arm.selects ? `"${arm.selects.id}"` : '"none"';
    definitions.push({
      name: actionName,
      body: `${condition} /\\ current_method' = ${selects} /\\ loop_count' = loop_count + 1`,
    });
  }

  // Next-state relation: disjunction of arm actions
  const next: TLAPredicate = {
    name: "Next",
    body: armActionNames.join(" \\/ "),
  };

  // Invariants from axioms
  const invariants: TLAProperty[] = Object.entries(methodology.domain.axioms).map(
    ([axiomName, _]) => ({
      name: `Inv_${sanitizeName(axiomName)}`,
      kind: "invariant" as const,
      body: `\\* Axiom: ${axiomName} (opaque check — not compilable to TLA+)`,
    }),
  );

  // Safety bound invariant
  invariants.push({
    name: "BoundedExecution",
    kind: "invariant",
    body: `loop_count <= ${methodology.safety.maxLoops}`,
  });

  // Liveness: objective eventually holds
  const properties: TLAProperty[] = [
    {
      name: "Terminates",
      kind: "temporal",
      body: '<>(status = "completed")',
    },
  ];

  return {
    name,
    extends: ["Naturals", "Sequences"],
    variables,
    constants: stateFields.map(f => `${f}_init`),
    definitions,
    init,
    next,
    invariants,
    properties,
  };
}

/**
 * Render a TLAModule to a .tla file string.
 */
export function renderTLA(module: TLAModule): string {
  const lines: string[] = [];
  lines.push(`---- MODULE ${module.name} ----`);
  lines.push(`EXTENDS ${module.extends.join(", ")}`);
  lines.push("");

  if (module.constants.length > 0) {
    lines.push(`CONSTANTS ${module.constants.join(", ")}`);
    lines.push("");
  }

  lines.push(`VARIABLES ${module.variables.map(v => v.name).join(", ")}`);
  lines.push("");

  // Helper definitions (arm actions, etc.)
  for (const def of module.definitions) {
    lines.push(`${def.name} == ${def.body}`);
  }
  if (module.definitions.length > 0) {
    lines.push("");
  }

  // Init
  lines.push(`${module.init.name} ==`);
  lines.push(`  ${module.init.body}`);
  lines.push("");

  // Next
  lines.push(`${module.next.name} ==`);
  lines.push(`  ${module.next.body}`);
  lines.push("");

  // Invariants
  for (const inv of module.invariants) {
    lines.push(`${inv.name} == ${inv.body}`);
  }
  if (module.invariants.length > 0) {
    lines.push("");
  }

  // Properties
  for (const prop of module.properties) {
    lines.push(`${prop.name} == ${prop.body}`);
  }
  if (module.properties.length > 0) {
    lines.push("");
  }

  lines.push("====");
  return lines.join("\n");
}

/**
 * Compile safety and liveness properties for a TLA+ config file (.cfg).
 */
export function compileProperties<S>(methodology: Methodology<S>): string {
  const lines: string[] = [];
  lines.push("SPECIFICATION Spec");
  lines.push("INVARIANT BoundedExecution");

  Object.keys(methodology.domain.axioms).forEach(axiomName => {
    lines.push(`INVARIANT Inv_${sanitizeName(axiomName)}`);
  });

  lines.push("PROPERTY Terminates");
  return lines.join("\n");
}

/** Convert a Predicate to a TLA+ expression (best-effort). */
function predicateToTLA<A>(pred: Predicate<A>): string {
  switch (pred.tag) {
    case "val":
      return pred.value ? "TRUE" : "FALSE";
    case "check":
      return `\\* check: ${pred.label}`;
    case "and":
      return `(${predicateToTLA(pred.left)} /\\ ${predicateToTLA(pred.right)})`;
    case "or":
      return `(${predicateToTLA(pred.left)} \\/ ${predicateToTLA(pred.right)})`;
    case "not":
      return `~(${predicateToTLA(pred.inner)})`;
    case "implies":
      return `(${predicateToTLA(pred.antecedent)} => ${predicateToTLA(pred.consequent)})`;
    case "forall":
      return `\\A x \\in Domain : ${predicateToTLA(pred.body)}`;
    case "exists":
      return `\\E x \\in Domain : ${predicateToTLA(pred.body)}`;
  }
}

/** Sanitize a name for use as a TLA+ identifier. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// Export helpers for testing
export { predicateToTLA as _predicateToTLA, sanitizeName as _sanitizeName };
