# Loader

## Responsibilities

`packages/core/src/loader.ts` owns YAML parsing, registry scanning, and path resolution within the registry directory. Two public functions:

### `listMethodologies(registryPath: string): MethodologyEntry[]`

Scans the registry directory and returns a summary tree.

1. Walk `registryPath` — each top-level subdirectory is a methodology (e.g., `P0-META/`)
2. For each methodology dir, find all `.yaml` files (top-level and in sub-directories)
3. Parse each YAML with `js-yaml`
4. Classify by root key: `methodology:` or `method:`
5. Extract summary fields only: `id`, `name`, `description` (from `navigation.what` or top-level `description`)
6. For methods: count `phases:` array length as `stepCount`
7. Return nested structure: methodologies with their child methods

```typescript
type MethodEntry = {
  methodId: string;
  name: string;
  description: string;
  stepCount: number;
};

type MethodologyEntry = {
  methodologyId: string;
  name: string;
  description: string;
  methods: MethodEntry[];
};
```

### `loadMethodology(registryPath: string, methodologyId: string, methodId: string): LoadedMethod`

Parses a single method YAML and extracts its step list.

1. Resolve path: `registry/{methodologyId}/{methodId}/{methodId}.yaml`
2. Fallback: if method path doesn't exist and `methodologyId === methodId`, try `registry/{methodologyId}/{methodologyId}.yaml`
3. Parse YAML with `js-yaml`
4. Check for `phases:` key (may be top-level or nested under `method:`)
5. If no `phases:`: throw with message "This is a methodology-level YAML without steps. Load a specific method instead."
6. Extract each phase into a `Step` — required fields: `id`, `name`; optional: `role`, `precondition`, `postcondition`, `guidance`, `output_schema`
7. Extract method-level metadata: `name` from `method.name` or `methodology.name`, `objective` from `objective.formal` or `objective.formal_statement`
8. Return `LoadedMethod`

```typescript
type Step = {
  id: string;
  name: string;
  role: string | null;
  precondition: string | null;
  postcondition: string | null;
  guidance: string | null;
  outputSchema: Record<string, unknown> | null;
};

type LoadedMethod = {
  methodologyId: string;
  methodId: string;
  name: string;
  objective: string | null;
  steps: Step[];
};
```

## YAML Shape Discrimination

Registry YAMLs have two shapes, distinguished by root key:

| Root key | Type | Has `phases:`? | Loadable for step traversal? |
|----------|------|---------------|------------------------------|
| `method:` | Method (M = 5-tuple) | Yes | Yes |
| `methodology:` | Methodology (Phi = coalgebra) | No | No (MVP) |

## Error Cases

- File not found: `"Method {methodId} not found under methodology {methodologyId}"`
- YAML parse failure: `"Failed to parse {path}: {yaml error}"`
- No phases key: `"YAML at {path} has no phases — this is a methodology, not a method. Load a specific method instead."`
- Empty phases array: `"Method {methodId} has no steps defined"`
