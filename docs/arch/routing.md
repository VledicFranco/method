# Routing

## Responsibility

`packages/core/src/routing.ts` extracts the transition function and predicate operationalization from a methodology-level YAML, returning a unified routing structure that an agent can evaluate client-side.

One public function:

### `getMethodologyRouting(registryPath: string, methodologyId: string): RoutingInfo`

Parses a methodology YAML and returns its routing criteria — the transition function arms and the predicates that govern them.

1. Resolve path: `registry/{methodologyId}/{methodologyId}.yaml`
2. Parse YAML with `js-yaml` (reuses the same `readFileSync` + `yaml.load` pattern as `loader.ts`)
3. Verify root key is `methodology:` — if the file has `method:` instead, throw
4. Extract `transition_function.arms`, `predicate_operationalization.predicates`, and `domain_theory.predicates`
5. Merge predicates: join formal predicates (`domain_theory.predicates`) with operationalization (`predicate_operationalization.predicates`) on the `name` field
6. Return `RoutingInfo`

## Return Type

```typescript
type RoutingPredicate = {
  name: string;
  description: string | null;   // from domain_theory.predicates
  trueWhen: string | null;      // from predicate_operationalization.predicates
  falseWhen: string | null;     // from predicate_operationalization.predicates
};

type RoutingArm = {
  priority: number;
  label: string;
  condition: string;
  selects: string | null;       // method ID from `returns` field (e.g., "M7-PRDS" extracted from "Some(M7-PRDS)"); null for "None"
  rationale: string | null;
};

type RoutingInfo = {
  methodologyId: string;
  name: string;
  predicates: RoutingPredicate[];
  arms: RoutingArm[];
  evaluationOrder: string;      // from predicate_operationalization.evaluation_order
};
```

## YAML Extraction Map

| Return field | YAML path | Notes |
|---|---|---|
| `methodologyId` | `methodology.id` | |
| `name` | `methodology.name` | |
| `predicates[].name` | `domain_theory.predicates[].name` | Join key |
| `predicates[].description` | `domain_theory.predicates[].description` | |
| `predicates[].trueWhen` | `predicate_operationalization.predicates[].true_when` | Matched by name |
| `predicates[].falseWhen` | `predicate_operationalization.predicates[].false_when` | Matched by name |
| `arms[].priority` | `transition_function.arms[].priority` | |
| `arms[].label` | `transition_function.arms[].label` | |
| `arms[].condition` | `transition_function.arms[].condition` | |
| `arms[].selects` | `transition_function.arms[].returns` | Extract method ID from `Some(...)` wrapper; `null` for `None` |
| `arms[].rationale` | `transition_function.arms[].rationale` | |
| `evaluationOrder` | `predicate_operationalization.evaluation_order` | |

## Predicate Merge Strategy

Formal predicates (`domain_theory.predicates`) define the name, signature, and description. Operationalization predicates (`predicate_operationalization.predicates`) define the concrete `true_when`/`false_when` criteria. These two lists are joined on the `name` field:

1. Start from the formal predicates list — this is the authoritative set
2. For each formal predicate, search the operationalization list for a matching `name`
3. If a match is found, attach `true_when` and `false_when`; otherwise leave them `null`
4. Operationalization predicates with names like `"task_type = section"` are compound names — the match uses the full string as-is, not just the base predicate name

The merge is best-effort. Not all formal predicates have operationalizations (e.g., `dispatched`, `is_method_selected`, `method_completed`, `addresses` are structural predicates that don't need agent-evaluable criteria). The returned list includes all formal predicates; only those with operationalization will have non-null `trueWhen`/`falseWhen`.

## Arm Filtering

The `arms` array is returned as-is from the YAML, including terminal arms (priority 8 `terminate`, priority 9 `executing` in P2-SD). These arms have `returns: "None"` — the `selects` field is `null` for them. The agent can use these to understand the full state machine, but only arms with non-null `selects` represent actionable routing decisions.

## Error Cases

- File not found: `"Methodology {methodologyId} not found in registry"`
- YAML parse failure: `"Failed to parse {path}: {yaml error}"`
- Not a methodology: `"YAML at {path} is a method, not a methodology. Routing is only available for methodology-level files."`
- No transition function: `"Methodology {methodologyId} has no transition_function defined"`

## Design Rationale

**Why return criteria for agent evaluation (Option A) rather than evaluating predicates server-side?**

The routing predicates (`task_type`, `multi_task_scope`) require contextual judgment that only the agent possesses. The server has no access to the challenge description, no knowledge of which PRDs exist, and no ability to evaluate whether "the architecture is unchanged by the new PRD." These predicates are inherently agent-evaluable — they describe conditions over the agent's working context, not over server state.

Returning the criteria makes the server a pure information provider. The agent reads the predicates' `true_when`/`false_when` descriptions, evaluates them against its current context, and follows the priority stack to determine which method to invoke. This keeps the server stateless with respect to routing and avoids coupling the MCP server to any particular agent's context model.

**Why a separate function rather than extending `loadMethodology`?**

`loadMethodology` operates on method-level YAMLs (files with `phases:`). `getMethodologyRouting` operates on methodology-level YAMLs (files with `transition_function:`). These are structurally different documents with different extraction logic. Combining them would violate the YAML shape discrimination documented in [loader.md](loader.md).

**Why live in a new file (`routing.ts`) rather than `loader.ts`?**

`loader.ts` handles two concerns: registry scanning (`listMethodologies`) and method loading (`loadMethodology`). Both produce structures for session traversal. Routing extraction is a different concern — it reads methodology-level structure for agent decision-making, not for step execution. A separate file keeps each module focused on one concern.
