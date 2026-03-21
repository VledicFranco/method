# Wave 1 Commission — PRD-020 Phase A

**Branch:** `feat/prd020-phase1` (base commit: `fbccfb1`)
**Scope Deadline:** 2h completion target
**Approval Gated By:** Phase A steering council decision (APPROVED ✓)

## Mission

Implement core interfaces for PRD-020 project isolation layer. Zero transport dependencies. Interfaces compile, unit tests pass, full contract coverage.

## Acceptance Criteria (HARD GATES)

1. **ProjectRegistry interface** (in-memory, queryable)
   - Load compiled YAML specs from `registry/` directory
   - Query methods: `find()`, `list()`, `getByName()`, `verify()`
   - Lazy-load semantics with caching
   - Parse + validate using js-yaml (existing methodology)
   - Unit tests: ≥5 tests covering success + error paths

2. **EventPersistence interface** (contract only, no transport)
   - Abstract interface for events (append-only, queryable)
   - Methods: `append(event)`, `query(filter)`, `latest(count)`
   - No HTTP, no database client code
   - Define `EventPersistenceContract` test suite
   - Tests: ≥4 contract tests (will be reused by Wave 2 implementations)

3. **ProjectEvent schema** (YAML-serializable)
   - Fields: `id`, `type`, `projectId`, `timestamp`, `data`, `metadata`
   - Type enum: `CREATED`, `REGISTRY_UPDATED`, `DISCOVERED`, `PUBLISHED`, `ISOLATED`
   - Serialization round-trip test

4. **IsolationValidator interface** (sync, pure)
   - Validate isolation rules against a ProjectRegistry
   - Method: `validate(registry: ProjectRegistry, projectId: string): ValidationResult`
   - ValidationResult: `{ valid: boolean, violations: Violation[] }`
   - Violation: `{ rule: string, severity: 'error' | 'warning', message: string }`
   - Unit tests: ≥4 tests covering valid + invalid scenarios

5. **Zero transport dependencies**
   - `packages/core/src/**` must not import http, net, ws, or any bridge modules
   - No fetch, axios, or request libraries
   - Verify: run `npm run test` in core package with transport check

6. **Compilation check**
   - `npm run build` in root completes with zero errors
   - Includes TypeScript strict mode compilation

7. **Test coverage**
   - All 4 interfaces have ≥3 tests each (minimum 12 unit tests total)
   - Real YAML fixtures from `registry/` used where applicable
   - Tests runnable via `npm test` in core package

## Scope — STRICT (Off-Limits)

**ONLY modify:**
- `packages/core/src/registry/` — ProjectRegistry + loaders
- `packages/core/src/events/` — EventPersistence, ProjectEvent, contract tests
- `packages/core/src/validation/` — IsolationValidator
- `packages/core/src/__tests__/` — test files for the above

**DO NOT modify:**
- `packages/mcp/`, `packages/bridge/`, `docs/`, `registry/`, `theory/`, `.method/`
- `package.json`, `tsconfig.json`, or any build config
- Any file outside the 4 directories above

**DO NOT commit:**
- `PHASE_A_RECHECK_*.txt` or `PHASE_A_RECHECK_*.md` files (leave them on master)

## Delivery Checklist

- [ ] All 4 interfaces defined (interfaces, not implementations)
- [ ] ProjectRegistry: load, query, validate YAML from registry/
- [ ] EventPersistence: contract interface + test suite
- [ ] ProjectEvent: schema with enum types
- [ ] IsolationValidator: pure sync validator
- [ ] Zero transport dependencies verified
- [ ] TypeScript compilation succeeds (strict mode)
- [ ] All unit tests pass (`npm test` in packages/core)
- [ ] Commit message: `feat(prd020-wave1): Core interfaces — ProjectRegistry, EventPersistence, IsolationValidator, ProjectEvent`

## Key Resources

- **Theory:** `theory/F1-FTH.md` (foundations), `theory/F4-PHI.md` (philosophy)
- **PRD-020:** `docs/prds/PRD-020.md` (context)
- **Existing patterns:** `packages/core/src/strategy/` (see how YAML loading is done)
- **Registry:** `registry/*.yaml` files (use these as fixtures)
- **Delivery rules:** `.method/project-card.yaml` (DR-01 through DR-13)

## Notes

- This is not a simulation. You are implementing for real. Code will be merged to main.
- Favor clarity and testability over brevity.
- If you encounter registry parsing errors, REPORT them — do not fix the registry files.
- Commit early and often. Keep commits focused.
- If blocked or unclear on scope, escalate immediately.

---

**Wave 1 Sub-Agent:** Implement interfaces for project isolation. No transport. Pure domain logic. Real YAML fixtures. Tests first where sensible.

Go.
