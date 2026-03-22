# API Contract Review Report
## Resource Copy Tools (MCP + HTTP API)

**Reviewer Role:** API Contract Reviewer (A)
**Feature:** Copy Modal UI + Backend Resource Copying
**Branch:** feat/prd020-phase3
**Date:** 2026-03-21

---

## Executive Summary

The resource copying API (both MCP tools and HTTP endpoints) has **moderate issues** around parameter validation, error response inconsistency, and incomplete documentation of limits. The core functionality is sound—partial failures are handled gracefully, and F-SEC-002 authorization is enforced. However, LLM clients using these tools lack clarity on several contract details.

**Critical Issues:** 2
**Major Issues:** 3
**Minor Issues:** 2

---

## Findings

### F-A-1: Missing Parameter Boundary Validation Documentation

**Severity:** MAJOR
**Category:** Parameter Validation & Documentation

**Description:**

The MCP tool specifications and API routes accept `target_ids` as an unbounded array with no documented limits:

- Minimum size: Can `target_ids` be empty? Spec doesn't say.
- Maximum size: No documented upper limit. What happens with 1000 targets?
- Per-project naming: No format validation for source_id or target_ids (e.g., can they contain `/`, `..`, special chars?).

**Evidence:**

MCP Tool Definition (packages/mcp/src/index.ts:719-722):
```typescript
target_ids: {
  type: "array",
  items: { type: "string" },
  description: "Target project IDs (directory names)",
}
```

HTTP Route Handler (packages/bridge/src/project-routes.ts:561):
```typescript
if (!source_id || !method_name || !target_ids || !Array.isArray(target_ids)) {
  return reply.status(400).send({
    error: 'Missing or invalid required fields: source_id, method_name, target_ids (array)',
  });
}
```

**No additional validation occurs.** The copier will accept `target_ids: []` and return `{ copied_to: [] }`. It will process 1000+ projects with no performance warning.

**Recommendation:**

1. **Define limits in spec:**
   - Minimum: `target_ids` must have >= 1 element
   - Maximum: Cap at 100-500 projects per call (with rationale in docs)
   - Format: Document that project IDs must be alphanumeric + hyphens/underscores (no slashes)

2. **Add runtime validation** to both HTTP handlers:
   ```typescript
   if (target_ids.length === 0) {
     return reply.status(400).send({ error: 'target_ids must not be empty' });
   }
   if (target_ids.length > 100) {
     return reply.status(400).send({ error: 'target_ids exceeds maximum of 100 projects' });
   }
   ```

3. **Update MCP spec** to include these constraints:
   ```typescript
   target_ids: {
     type: "array",
     items: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
     minItems: 1,
     maxItems: 100,
     description: "Target project IDs (1-100 alphanumeric directories)",
   }
   ```

---

### F-A-2: Inconsistent Error Response Format Between Success and Failure Paths

**Severity:** CRITICAL
**Category:** Response Contract Consistency

**Description:**

When the HTTP API encounters an error (missing source/methodology), the **entire request** fails with HTTP 500, but the actual error is a business logic failure (not a server error):

```typescript
// packages/bridge/src/project-routes.ts:585-589
} catch (err) {
  return reply.status(500).send({
    error: 'Resource copy failed',
    message: (err as Error).message,
  });
}
```

However, **partial failures are handled correctly** (HTTP 200 with per-target status in `copied_to`). This creates a perception asymmetry:

- **One target fails?** → HTTP 200, reported in `copied_to[].status`
- **All targets fail?** → HTTP 500, thrown as exception

**Example Scenarios:**

1. Source methodology not found:
   - Status: HTTP 500 (should be 400 or 404)
   - Response: `{ error: 'Resource copy failed', message: 'Source project... not found' }`

2. Some targets valid, some invalid:
   - Status: HTTP 200
   - Response: `{ copied_to: [{ status: 'success' }, { status: 'error', error_detail: '...' }] }`

**LLM clients cannot reliably distinguish** between:
- Transient server errors (should retry)
- Business logic failures (should not retry)
- Partial success (may want to notify user)

**Evidence:**

packages/bridge/src/resource-copier.ts:134-167 shows no exception thrown when source not found—it returns a valid `CopyResponse` with error details:

```typescript
if (!sourceManifest) {
  for (const targetId of target_ids) {
    results.push({
      project_id: targetId,
      status: 'error',
      error_detail: `Source project "${source_id}" not found or manifest invalid`,
    });
  }
  return { copied_to: results };  // ← Returns 200, not exception
}
```

But the HTTP route wraps this in try-catch and converts to 500 on any unhandled exception. If `copyMethodology()` throws unexpectedly, clients see HTTP 500 instead of a structured response.

**Recommendation:**

1. **Define error semantics clearly:**
   - **400 Bad Request:** Missing required fields, invalid array size, malformed project IDs
   - **403 Forbidden:** F-SEC-002 authorization failure (cannot access source project)
   - **404 Not Found:** (optional) Source project or methodology/strategy not found
   - **200 OK (with errors in body):** Partial success case (some targets succeed, some fail)
   - **500 Internal Server Error:** Unhandled exceptions only (file I/O errors, YAML serialization crashes)

2. **Update HTTP handlers** to avoid wrapping the copier response in generic try-catch:
   ```typescript
   try {
     const result = await copyMethodology({ source_id, method_name, target_ids });
     // If all failed, consider 400 or 404 instead of 200
     const allFailed = result.copied_to.every(r => r.status === 'error');
     const status = allFailed ? 400 : 200;
     return reply.status(status).send(result);
   } catch (err) {
     // Only thrown for unhandled exceptions (file I/O, etc.)
     return reply.status(500).send({
       error: 'Internal server error',
       message: (err as Error).message,
     });
   }
   ```

3. **Update MCP tool descriptions** to document error response structure:
   ```
   Returns { copied_to: [{ project_id, status: 'success'|'error', error_detail?: string }] }.
   - HTTP 200: Request completed (may include per-target errors).
   - HTTP 400: Invalid parameters or all targets failed.
   - HTTP 403: Authorization denied (F-SEC-002).
   ```

---

### F-A-3: Unclear Error Detail Field Presence and Semantics

**Severity:** MAJOR
**Category:** Response Contract Clarity

**Description:**

The `CopyResult` interface (packages/bridge/src/resource-copier.ts:20-24) marks `error_detail` as optional:

```typescript
export interface CopyResult {
  project_id: string;
  status: 'success' | 'error';
  error_detail?: string;
}
```

But **contract rules are not explicit:**

1. Is `error_detail` **always** present when `status === 'error'`?
2. Is it **never** present when `status === 'success'`?
3. What if the error message itself is empty?

**Evidence:**

Test at packages/bridge/src/__tests__/resource-copier-routes.test.ts:272 checks for error status but doesn't verify error_detail presence:

```typescript
assert.strictEqual(invalidResult.status, 'error');
// Does not assert: assert(invalidResult.error_detail); ← Missing contract check
```

The implementation writes error_detail only on error paths (resource-copier.ts:230, 344) and omits it on success paths (lines 224, 338). This is **correct behavior**, but LLM clients relying on this need explicit contract documentation.

**Recommendation:**

1. **Update interface documentation** to make contract explicit:
   ```typescript
   export interface CopyResult {
     project_id: string;
     status: 'success' | 'error';
     /**
      * Human-readable error message.
      * Present only when status === 'error'.
      * Absent when status === 'success'.
      */
     error_detail?: string;
   }
   ```

2. **Add JSDoc comments** to `CopyResponse`:
   ```typescript
   export interface CopyResponse {
     /**
      * Array of per-target results.
      * Length guaranteed to equal target_ids.length from request.
      * Results appear in same order as target_ids.
      * Each entry has status='success' or status='error' with error_detail.
      */
     copied_to: CopyResult[];
   }
   ```

3. **Add test assertion** to verify contract:
   ```typescript
   for (const result of body.copied_to) {
     if (result.status === 'error') {
       assert(result.error_detail, 'error_detail must be present when status=error');
     } else {
       assert(!result.error_detail, 'error_detail must be absent when status=success');
     }
   }
   ```

---

### F-A-4: Response Array Ordering and Alignment Not Documented

**Severity:** MAJOR
**Category:** Response Contract Clarity

**Description:**

The API **guarantees** that `copied_to` array entries align with the input `target_ids` order, but this is **not documented**:

```typescript
// Implicit contract (not documented):
POST /api/resources/copy-methodology
{ source_id: 'src', method_name: 'P2-SD', target_ids: ['proj-a', 'proj-b', 'proj-c'] }

Response:
{ copied_to: [
  { project_id: 'proj-a', status: 'success' },    // ← Same order as target_ids
  { project_id: 'proj-b', status: 'error', ... }, // ← Same order as target_ids
  { project_id: 'proj-c', status: 'success' },    // ← Same order as target_ids
]}
```

**Evidence:**

The implementation iterates target_ids in order and pushes results in order (resource-copier.ts:173-240):

```typescript
for (const targetId of target_ids) {
  // ... process targetId ...
  results.push({
    project_id: targetId,
    status: ...,
  });
}
return { copied_to: results };
```

**This is correct** but not guaranteed in the spec. If the implementation changes to parallel processing, the order could change—and client code could silently break.

**Recommendation:**

1. **Document the ordering guarantee** in MCP tool description:
   ```
   "Returns { copied_to: [...] } with results in the same order as target_ids input.
   Each result includes project_id, status ('success'|'error'), and optional error_detail.
   The copied_to array length always equals target_ids.length."
   ```

2. **Enforce ordering at runtime** if parallelizing:
   ```typescript
   const resultsByTarget = new Map(await Promise.all(
     target_ids.map(id => copyToTarget(id))
   ));
   const results = target_ids.map(id => resultsByTarget.get(id)!);
   ```

3. **Add test to verify alignment**:
   ```typescript
   const target_ids = ['a', 'b', 'c'];
   const res = await copy({ ..., target_ids });
   assert.deepStrictEqual(
     res.copied_to.map(r => r.project_id),
     target_ids,
     'Result order must match target_ids order'
   );
   ```

---

### F-A-5: F-SEC-002 Authorization Only Checks Source, Not Targets

**Severity:** CRITICAL
**Category:** Security & Isolation

**Description:**

The HTTP routes enforce F-SEC-002 authorization **only for the source project**, not for targets:

```typescript
// packages/bridge/src/project-routes.ts:567-576
const sessionContext = getSessionContext(req);
const sourceValidation = validateProjectAccess(source_id, sessionContext);
if (!sourceValidation.allowed) {
  return reply.status(403).send({ ... });
}

// ← No validation for target_ids access
```

**The copier** (resource-copier.ts) validates target existence by checking for `.git` directory but **does not check authorization**:

```typescript
// packages/bridge/src/resource-copier.ts:177-184
if (!fs.existsSync(path.join(targetPath, '.git'))) {
  // ← Only checks existence, not authorization
}
```

**Scenario:**

1. User is in session context for project 'proj-a'
2. User requests: copy from 'proj-a' (allowed) to ['proj-a', 'proj-b'] (not allowed)
3. Current behavior: ✓ passes source check, copies to both proj-a and proj-b
4. Expected behavior: ✗ should reject if user cannot write to proj-b

**Evidence:**

The `validateProjectAccess()` function (project-routes.ts:147-165) checks **equality**, not just existence:

```typescript
if (sessionContext.projectId && sessionContext.projectId !== requestedProjectId) {
  return { allowed: false, ... };
}
```

But this check is only applied to source_id, not to each target_id.

**Recommendation:**

1. **Validate target access** before copying:
   ```typescript
   for (const targetId of target_ids) {
     const targetValidation = validateProjectAccess(targetId, sessionContext);
     if (!targetValidation.allowed) {
       return reply.status(403).send({
         error: 'Access denied',
         reason: `Cannot write to target project ${targetId}`,
       });
     }
   }
   ```

   **Alternative:** Fail per-target and report in `copied_to`:
   ```typescript
   // Let copier run, but each failed auth becomes error in result
   // Requires passing sessionContext to copier function
   ```

2. **Update MCP tool description** to clarify authorization scope:
   ```
   "Requires read access to source project and write access to all target projects (F-SEC-002).
   If authorization fails for any target, that target will be reported as error in copied_to."
   ```

3. **Add test for cross-project access denial**:
   ```typescript
   // Simulate: User in session 'proj-a', attempts copy to ['proj-a', 'proj-b']
   const response = await request({
     headers: { 'x-project-id': 'proj-a' },
     body: { source_id: 'proj-a', target_ids: ['proj-b'] },
   });
   assert.strictEqual(response.statusCode, 403); // Should deny
   ```

---

### F-A-6: Backwards Compatibility Not Addressed

**Severity:** MINOR
**Category:** API Stability & Versioning

**Description:**

The API lacks versioning or backwards compatibility strategy:

- No API version in URL path (`/api/v1/resources/...` vs `/api/resources/...`)
- No version header negotiation
- Response structure could change (e.g., renaming `error_detail` → `detail`)

If the API changes in the future (e.g., adding new fields to `CopyResult`), clients cannot safely handle unknown fields.

**Evidence:**

HTTP routes use unversioned paths:
```typescript
app.post('/api/resources/copy-methodology', ...);
app.post('/api/resources/copy-strategy', ...);
```

IANA doesn't specify additive field safety in response JSON.

**Recommendation:**

1. **Adopt semantic versioning for responses:**
   - Renaming fields: requires major version bump
   - Adding optional fields: safe with minor version
   - Removing fields: requires major version bump

2. **Include version info** in response:
   ```typescript
   {
     api_version: "1.0",
     copied_to: [...]
   }
   ```

3. **Document stability guarantees** in MCP spec:
   ```
   "Stability: The copied_to array structure is stable. New fields may be added
   with minor version bumps but will not rename or remove existing fields."
   ```

---

### F-A-7: Missing Documentation on Project ID Format and Path Safety

**Severity:** MINOR
**Category:** Documentation & Usability

**Description:**

The MCP tool and HTTP API accept project IDs as strings with no documented format constraints. The copier resolves them to filesystem paths, creating potential security risks:

```typescript
// packages/bridge/src/resource-copier.ts:47-60
function resolveProjectPath(projectId: string): string {
  if (projectId === 'root' || projectId === '.') {
    return process.cwd();
  }

  // RISK: No validation of projectId format
  if (projectId.includes(path.sep) || projectId.includes('/')) {
    return path.resolve(projectId);  // ← Could resolve to arbitrary paths
  }

  return path.resolve(process.cwd(), projectId);
}
```

**Example Attack:**

```
POST /api/resources/copy-methodology
{
  source_id: "../../../etc/passwd",  // ← Path traversal?
  method_name: "P2-SD",
  target_ids: ["../../../tmp/exploit"]
}
```

While the subsequent `.git` directory check provides **some** protection, it's not a guarantee against all path traversal.

**Evidence:**

No validation in MCP tool spec or HTTP route validates project ID format before calling copier.

**Recommendation:**

1. **Define project ID format** in MCP spec:
   ```typescript
   source_id: {
     type: "string",
     pattern: "^(root|[a-zA-Z0-9_-]+)$",
     description: "Source project ID: 'root' or alphanumeric with hyphens/underscores only",
   }
   ```

2. **Add runtime validation** in copier:
   ```typescript
   function validateProjectId(projectId: string): boolean {
     // Allow 'root' as special case
     if (projectId === 'root' || projectId === '.') return true;
     // Must be alphanumeric + hyphens/underscores
     return /^[a-zA-Z0-9_-]+$/.test(projectId);
   }
   ```

3. **Reject path separators explicitly:**
   ```typescript
   if (projectId.includes(path.sep) || projectId.includes('/') || projectId.includes('..')) {
     throw new Error(`Invalid project ID: path separators not allowed`);
   }
   ```

---

## Summary Table

| ID    | Severity | Category                   | Status | Fix Effort |
|-------|----------|----------------------------|--------|-----------|
| F-A-1 | MAJOR    | Parameter Validation       | Open   | Low       |
| F-A-2 | CRITICAL | Response Consistency       | Open   | Medium    |
| F-A-3 | MAJOR    | Response Contract Clarity  | Open   | Low       |
| F-A-4 | MAJOR    | Documentation             | Open   | Low       |
| F-A-5 | CRITICAL | Security (F-SEC-002)       | Open   | High      |
| F-A-6 | MINOR    | API Stability             | Open   | Low       |
| F-A-7 | MINOR    | Path Safety               | Open   | Medium    |

---

## Implementation Priority

1. **F-A-5** (CRITICAL): Add target project authorization checks → Blocks security sign-off
2. **F-A-2** (CRITICAL): Clarify error response semantics → Required for reliable client retry logic
3. **F-A-1** (MAJOR): Add parameter validation and documentation → LLM clients need explicit limits
4. **F-A-3** (MAJOR): Formalize error_detail field contract → Prevents misuse
5. **F-A-4** (MAJOR): Document result ordering → Prevents silent failures with parallel processing
6. **F-A-7** (MINOR): Validate project ID format → Defense in depth
7. **F-A-6** (MINOR): Adopt versioning strategy → Future-proofing

---

## Conclusion

The resource copying API has **solid core logic** (partial failures are handled gracefully, F-SEC-002 is partially enforced), but **lacks clarity and precision in its contracts**. LLM clients and HTTP integrators will struggle with:

- When to retry vs. give up
- Whether response field presence is guaranteed
- Whether result order is preserved
- What project IDs are allowed

**Recommended timeline:** Address F-A-5 and F-A-2 before merging to main. F-A-1, F-A-3, F-A-4 should be addressed in the same PR. F-A-6 and F-A-7 can be deferred to Phase 4.
