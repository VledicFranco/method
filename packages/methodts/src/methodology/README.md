# methodology/ — Methodology Types

The top-level formal unit of the method system. A `Methodology<S>` is a finite-state machine over world state `S` composed of arms (branches), each associated with a method, safety bounds, and termination conditions.

## Components

| Component | Description |
|-----------|-------------|
| `Methodology<S>` | The top-level execution unit: named arms, initial arm, safety bounds |
| `Arm<S>` | A branch within a methodology: a method + transition predicates |
| `SafetyBounds` | Hard limits on methodology execution: max steps, max time, max cost |
| `TerminationCertificate<S>` | Proof that a methodology execution reached a valid terminal state |
| `asMethodology()` | Lifts a single `Method<S>` into a `Methodology<S>` (single-arm convenience) |
| `transition.ts` | Transition predicate types and evaluation |
| `safety.ts` | Safety bound checking — called by runtime before every step |
| `retraction.ts` | Retraction: undo semantics when a methodology arm fails |

## Design

The methodology is the unit registered in `.method/manifest.yaml` and exposed via the MCP server. Agents invoke methodologies by name; the runtime resolves the methodology, checks safety bounds, evaluates transition predicates, and dispatches steps to the agent provider.

Retraction provides a clean failure path: if a methodology arm exceeds safety bounds or fails a terminal gate, retraction logic rolls back partial world state changes and surfaces a structured error to the caller.
