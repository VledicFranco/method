# WAVE 1 — PRD-020 Phase A Implementation

**Current Branch:** `feat/prd020-phase1`
**Stub Commit:** `fbccfb1`
**Task:** Implement 4 core interfaces for project isolation layer

## MISSION

Implement interfaces for project isolation. Zero transport dependencies. All interfaces compile. Unit tests pass.

## SCOPE (STRICT)

**ONLY modify:**
- `packages/core/src/registry/` — ProjectRegistry
- `packages/core/src/events/` — EventPersistence, ProjectEvent
- `packages/core/src/validation/` — IsolationValidator
- `packages/core/src/__tests__/` — tests

**DO NOT modify:** mcp/, bridge/, docs/, registry/, theory/, .method/, build config, package.json

## 4 INTERFACES TO IMPLEMENT

### 1. ProjectRegistry (in-memory, queryable YAML loader)

```typescript
interface ProjectRegistry {
  // Load specs from registry/*.yaml
  initialize(): Promise<void>;

  // Query methods
  find(name: string): MethodologySpec | undefined;
  list(): MethodologySpec[];
  getByName(name: string): MethodologySpec | undefined;

  // Validation
  verify(spec: MethodologySpec): VerifyResult;
}

interface VerifyResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

- Load YAML from `registry/` directory
- Use js-yaml for parsing
- Cache loaded specs in memory
- Unit tests: ≥5 tests (success, error cases, caching)

### 2. ProjectEvent (YAML-serializable schema)

```typescript
interface ProjectEvent {
  id: string;              // UUID
  type: ProjectEventType;  // enum
  projectId: string;
  timestamp: Date;
  data: Record<string, any>;
  metadata: Record<string, any>;
}

enum ProjectEventType {
  CREATED = 'CREATED',
  REGISTRY_UPDATED = 'REGISTRY_UPDATED',
  DISCOVERED = 'DISCOVERED',
  PUBLISHED = 'PUBLISHED',
  ISOLATED = 'ISOLATED',
}
```

- Serializable to/from YAML
- Round-trip test (serialize → deserialize)
- Unit tests: ≥1 test

### 3. EventPersistence (abstract interface, contract only)

```typescript
interface EventPersistence {
  // Abstract — no transport/DB dependencies
  append(event: ProjectEvent): Promise<void>;
  query(filter: EventFilter): Promise<ProjectEvent[]>;
  latest(count: number): Promise<ProjectEvent[]>;
}

interface EventFilter {
  projectId?: string;
  type?: ProjectEventType;
  since?: Date;
  until?: Date;
}
```

- Define EventPersistenceContract test suite
- Tests reusable by Wave 2 implementations
- Unit tests: ≥4 contract tests

### 4. IsolationValidator (sync, pure validator)

```typescript
interface IsolationValidator {
  validate(
    registry: ProjectRegistry,
    projectId: string
  ): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

interface Violation {
  rule: string;           // e.g., "registry-immutability"
  severity: 'error' | 'warning';
  message: string;
}
```

- Sync operation (no async)
- Pure function (no side effects)
- Unit tests: ≥4 tests (valid + invalid scenarios)

## ACCEPTANCE GATES (HARD)

1. **All 4 interfaces** — fully implemented, exported from index files
2. **Zero transport deps** — verify with `npm ls` (no http, net, ws, fetch, axios)
3. **TypeScript compilation** — `npm run build` succeeds, strict mode
4. **Unit tests** — `npm test` passes, ≥12 total tests across 4 interfaces
5. **Code organization** — focused commits, clear commit messages

## WORKFLOW

1. **Examine existing patterns:**
   - Read `packages/core/src/strategy/` to see how YAML loading is done
   - Check `registry/` directory structure (YAML format)

2. **Implement in order:**
   - ProjectRegistry (foundation)
   - ProjectEvent (data model)
   - EventPersistence (abstract interface)
   - IsolationValidator (business logic)

3. **Write tests as you go** (real fixtures from registry/)

4. **Verify:**
   ```bash
   npm run build        # TypeScript compilation
   npm test             # All tests pass
   npm ls               # No unexpected transport deps
   ```

5. **Final commit:**
   ```
   git add packages/core/src/{registry,events,validation}/ packages/core/src/__tests__/
   git commit -m "feat(prd020-wave1): Core interfaces — ProjectRegistry, EventPersistence, IsolationValidator, ProjectEvent"
   git push origin feat/prd020-phase1
   ```

## RESOURCES

- **YAML patterns:** See `packages/core/src/strategy/` for MethodologyRegistry
- **Registry specs:** Check `registry/` for actual YAML format
- **Theory:** `theory/F1-FTH.md`, `theory/F4-PHI.md` (context)
- **PRD:** `docs/prds/PRD-020.md` (Phase A details)

## GO

Begin now. Report progress after each interface. Finish with final commit hash and test output.
