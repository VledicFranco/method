---
guide: 20
title: "Resource Sharing"
domain: multi-project
audience: [agent-operators]
summary: >-
  Copying methodologies and strategies across projects with per-target error reporting.
prereqs: [19]
touches:
  - packages/bridge/src/resource-copier.ts
  - packages/bridge/src/project-routes.ts
---

# Guide 20 — Resource Sharing (PRD 020 Phase 3)

How to copy methodologies and strategies between projects. Covers the copy modal interface, API endpoints, manifest management, and operational safety features.

## Overview

**Resource sharing** lets you distribute methodologies and strategies from a source project to multiple target projects in a single operation. This enables:

- **Methodology distribution** — Copy a tested methodology (P2-SD, P1-EXEC) from one project to many
- **Strategy replication** — Share pipeline strategies and execution plans across teams
- **Bulk operations** — Copy to multiple targets with per-target error reporting
- **Safe concurrency** — File locking prevents manifest corruption under concurrent access

### When to Use Resource Sharing

✅ **Use resource sharing when:**
- Distributing a proven methodology to multiple projects
- Replicating strategies across team codebases
- Standardizing practices across a portfolio of projects
- Consolidating related resources

❌ **Don't use when:**
- Copying a single resource to a single target (use manual manifest editing)
- Moving resources (use archive + delete workflow instead)
- Projects are isolated by compliance boundary (check access policies first)

---

## Architecture

### Copy Flow

```
User clicks "Copy to Projects" button
        ↓
Modal opens, loads project list
        ↓
User selects source (pre-populated) + targets
        ↓
Click "Copy" button
        ↓
HTTP POST /api/resources/copy-methodology
        ↓
Authorization check (F-SEC-002)
  → validateProjectAccess(source)
  → validateProjectAccess(each target)
        ↓
Copy operation (resource-copier.ts)
  → Load source manifest
  → Find methodology/strategy entry
  → For each target:
    - Apply file lock
    - Load target manifest
    - Add/merge entry
    - Write manifest (atomic: temp → rename)
    - Release lock
        ↓
Per-target results returned
        ↓
Modal displays: N succeeded, M failed
```

### Key Components

| Component | File | Responsibility |
|-----------|------|-----------------|
| **UI Modal** | `dashboard.html` (lines 1138-1171) | Copy modal form, project selection, results display |
| **Button** | `dashboard.html` (line 1110) | "Copy to Projects" button in header |
| **Routes** | `project-routes.ts` (lines 554-632) | HTTP endpoints: `/api/resources/copy-methodology`, `/api/resources/copy-strategy` |
| **Core Logic** | `resource-copier.ts` | Manifest loading, entry copying, atomic writes, file locking |
| **Authorization** | `project-routes.ts` (lines 557-583) | validateProjectAccess for source and all targets |

### Safety Features

#### 1. Target Access Validation (F-SEC-002)
```typescript
// Before copying, verify requester can access ALL targets
// validateProjectAccess checks that the session's x-project-id header matches the target.
// No role-based auth — anonymous/unauthenticated requests (no x-project-id) are allowed for reads.
for (const targetId of target_ids) {
  const validation = validateProjectAccess(targetId, sessionContext);
  if (!validation.allowed) {
    return reply.status(403).send({
      error: 'Access denied to one or more target projects',
      reason: `Cannot copy to project ${targetId} — permission denied`,
      message: validation.reason || 'Not authorized to write to target project'
    });
  }
}
```

**Protection:** Prevents cross-project writes when a session is bound to a different project via `x-project-id`.

#### 2. Manifest Write Lock (F-R-2)
```typescript
// Advisory lock prevents concurrent writes corrupting manifest
const lockPath = path.join(methodDir, '.manifest.lock');

// Try to acquire lock (10 retries × 100ms = 1 second max)
while (fs.existsSync(lockPath) && retries-- > 0) {
  await sleep(100);
}

// Write lock file
fs.writeFileSync(lockPath, Date.now().toString());
try {
  // Atomic write: temp file → rename
  fs.writeFileSync(manifestPath + '.tmp', content);
  fs.renameSync(manifestPath + '.tmp', manifestPath);
} finally {
  fs.unlinkSync(lockPath);  // Release lock
}
```

**Protection:** Two concurrent copies to the same project won't create duplicate entries.

#### 3. Per-Target Error Reporting
```json
{
  "copied_to": [
    { "project_id": "proj-a", "status": "success" },
    { "project_id": "proj-b", "status": "error", "error_detail": "Permission denied" },
    { "project_id": "proj-c", "status": "success" }
  ]
}
```

**Protection:** User sees exactly which targets succeeded/failed and why. Can retry only failed targets.

---

## Using the Copy Feature

### Via Dashboard UI

#### Step 1: Open Copy Modal
1. Navigate to dashboard: http://localhost:3456/dashboard
2. Click **"📋 Copy to Projects"** button in header
3. Modal opens with pre-populated source project

#### Step 2: Select Target Projects
1. Modal displays "Target Projects (select at least one)"
2. Project list loads automatically
3. Source project is **excluded** from target list (prevents self-copy)
4. Check boxes for 1 or more target projects
5. "Copy" button enables once ≥1 target selected

#### Step 3: Execute Copy
1. Click **"Copy"** button
2. Modal shows "Copying..." with loading state
3. After completion, see results:
   - ✅ Success: "Successfully copied P2-SD to 3 projects"
   - ❌ Partial: "Copied to 2 projects, 1 failed"
   - ❌ Error: Red error message with reason

#### Step 4: Verify Results
1. Close modal
2. Navigate to target project directory
3. Check `.method/manifest.yaml`:
   ```yaml
   manifest:
     installed:
       - id: P2-SD
         type: methodology
         version: "2.0"
         name: Software Delivery
         installed_at: "2026-03-21T00:00:00Z"
   ```

### Via HTTP API

#### Copy Methodology

```bash
curl -X POST http://localhost:3456/api/resources/copy-methodology \
  -H "Content-Type: application/json" \
  -H "x-project-id: root" \
  -d '{
    "source_id": "proj-a",
    "method_name": "P2-SD",
    "target_ids": ["proj-b", "proj-c", "proj-d"]
  }'
```

**Response:**
```json
{
  "copied_to": [
    { "project_id": "proj-b", "status": "success" },
    { "project_id": "proj-c", "status": "success" },
    { "project_id": "proj-d", "status": "success" }
  ]
}
```

#### Copy Strategy

```bash
curl -X POST http://localhost:3456/api/resources/copy-strategy \
  -H "Content-Type: application/json" \
  -H "x-project-id: root" \
  -d '{
    "source_id": "proj-a",
    "strategy_name": "deploy-pipeline",
    "target_ids": ["proj-b", "proj-c"]
  }'
```

### Error Handling

#### User Has No Access to Target
```json
{
  "error": "Access denied to one or more target projects",
  "reason": "Cannot copy to project forbidden-proj — permission denied",
  "message": "Not authorized to write to target project"
}
```
→ Check that your `x-project-id` header matches the target project, or omit it for read-only discovery access.

#### Source Not Found
```json
{
  "copied_to": [
    {
      "project_id": "proj-b",
      "status": "error",
      "error_detail": "Source project \"unknown-proj\" not found or manifest invalid"
    }
  ]
}
```
→ Verify source project ID and that its `.method/manifest.yaml` exists.

#### Methodology Not Found in Source
```json
{
  "copied_to": [
    {
      "project_id": "proj-b",
      "status": "error",
      "error_detail": "Methodology \"UNKNOWN\" not found in source project"
    }
  ]
}
```
→ Check source project's manifest for the correct methodology ID.

#### Partial Failure (1 Target Succeeds, 1 Fails)
```json
{
  "copied_to": [
    { "project_id": "proj-a", "status": "success" },
    { "project_id": "proj-b", "status": "error", "error_detail": "Permission denied" }
  ]
}
```
→ User can retry just the failed target without re-selecting succeeded ones.

---

## Manifest Structure

### After Copying a Methodology

**Before:**
```yaml
manifest:
  installed: []
```

**After copying P2-SD:**
```yaml
manifest:
  installed:
    - id: P2-SD
      type: methodology
      version: "2.0"
      name: Software Delivery
      installed_at: "2026-03-21T00:00:00Z"
  last_updated: "2026-03-22"
```

### Key Fields

| Field | Meaning |
|-------|---------|
| `id` | Methodology/strategy identifier (e.g., "P2-SD", "deploy-v1") |
| `type` | "methodology" or "strategy" |
| `version` | Version of the resource being copied |
| `name` | Human-readable name |
| `installed_at` | ISO 8601 timestamp when originally installed |
| `last_updated` | ISO 8601 date of most recent modification |

---

## Operational Considerations

### Concurrency Safety

✅ **Safe:** Multiple copies to different targets run in parallel.
```
User A copies P2-SD to proj-x, proj-y, proj-z
User B copies P1-EXEC to proj-a, proj-b
→ Both operations proceed without blocking
```

✅ **Safe:** Two copies to the same target are serialized by file lock.
```
User A copies P2-SD to proj-x (acquiring lock)
User B copies P1-EXEC to proj-x (waits for lock)
→ No manifest corruption, both succeed atomically
```

❌ **Unsafe:** Direct manifest edits during copy.
```
User A is copying to proj-x (lock acquired)
User B manually edits proj-x/.method/manifest.yaml
→ Data loss or corruption possible
→ Always use copy API, never hand-edit during operations
```

### Monitoring & Alerts

**Watch for these issues in Week 1 post-launch:**

1. **Manifest corruption reports** — Rare with F-R-2 lock, but monitor. Indicates lock timeout exceeded.
2. **Authorization bypass attempts** — Should fail with 403. If succeeds, check validateProjectAccess().
3. **User confusion about discoverability** — Should have "Copy to Projects" button. If users can't find it, check dashboard.html.

### Best Practices

1. **Verify source before bulk copy** — Copy 1 target first, inspect result, then copy to many.
   ```bash
   # Test copy
   curl ... -d '{ "source_id": "proj-a", ..., "target_ids": ["proj-test"] }'
   # Verify proj-test/.method/manifest.yaml
   # Then copy to all 10 targets
   ```

2. **Document your standard methodologies** — List approved source projects in your team wiki.
   ```markdown
   ## Approved Methodology Sources
   - proj-a: Contains P2-SD v2.0, P1-EXEC v1.1 (reference)
   - proj-b: Contains RETRO-PROTO v1.0 (retrospectives)
   ```

3. **Check access policies before bulk operations** — Verify all target projects exist and you have write access.
   ```bash
   # Dry-run: attempt copy to 1 target
   curl ... -d '{ ..., "target_ids": ["proj-z"] }' | jq .
   # If 403, you're missing write permission to proj-z
   ```

4. **Avoid copying to production projects directly** — Use staging first.
   ```
   ✅ Copy to staging → Verify → Copy to prod
   ❌ Copy directly to prod → Risk of unexpected state
   ```

---

## Troubleshooting

### Modal Won't Open

**Symptom:** Click "Copy to Projects" button, nothing happens.

**Check:**
1. Is bridge running? `curl http://localhost:3456/health`
2. Does button exist? `curl http://localhost:3456/dashboard | grep -o "Copy to Projects"`
3. Browser console for errors? (F12 → Console tab)

**Fix:** Restart bridge.
```bash
npm run bridge:stop
npm run bridge
```

### Projects Won't Load in Modal

**Symptom:** Modal opens but says "Loading projects..." forever or shows error.

**Check:**
1. Are projects discoverable? Projects must have `.git` directory.
2. Do source project `.method/manifest.yaml` files exist and are valid YAML?

**Fix:** Validate manifests.
```bash
cd proj-a/.method
node -e "const yaml = require('js-yaml'); console.log(yaml.load(require('fs').readFileSync('manifest.yaml', 'utf-8')));"
```

### Permission Denied Error

**Symptom:** Copy fails with "Cannot copy to project X — permission denied".

**Check:**
1. Is your `x-project-id` header set to a value that matches the target? (`validateProjectAccess` checks that the session's `x-project-id` matches the requested project ID. There is no role-based auth.)
2. If you omit `x-project-id`, the request is allowed for reads but the copy endpoint requires matching context.
3. Does target project exist? (has `.git` directory)

**Fix:** Verify that your `x-project-id` header matches the target project, or remove it if your deployment allows anonymous access.
```bash
# Verify with explicit project context
curl -X POST http://localhost:3456/api/resources/copy-methodology \
  -H "Content-Type: application/json" \
  -H "x-project-id: target-proj" \
  -d '{ "source_id": "source-proj", "method_name": "P2-SD", "target_ids": ["target-proj"] }'
```

### Manifest Has Duplicate Entries

**Symptom:** After copying, manifest has 2 copies of the same methodology.

**Check:**
1. Was this caused by rapid double-clicks on the Copy button?
2. Was there a network timeout that led to retry?

**Fix:** Edit `.method/manifest.yaml` and remove the duplicate entry manually, OR:
1. Delete the entire `manifest.yaml`
2. Re-run copy operation
3. Verify single entry exists

**Prevention:** The F-R-2 file lock should prevent this. If it happens repeatedly, check bridge logs for lock timeout errors.

---

## API Reference

### POST /api/resources/copy-methodology

**Copy a methodology from one project to many.**

**Request Headers:**
```
Content-Type: application/json
x-project-id: <source or root>  [optional, for session context]
```

**Request Body:**
```json
{
  "source_id": "proj-a",
  "method_name": "P2-SD",
  "target_ids": ["proj-b", "proj-c", "proj-d"]
}
```

**`target_ids` format constraint:** Each ID must match `/^[a-z0-9_-]{3,64}$/` (lowercase alphanumeric, hyphens, underscores; 3-64 characters). The array must contain 1-100 items.

**Response (200 OK):**
```json
{
  "copied_to": [
    { "project_id": "proj-b", "status": "success" },
    { "project_id": "proj-c", "status": "success" },
    { "project_id": "proj-d", "status": "error", "error_detail": "..." }
  ]
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Missing or invalid required fields: source_id, method_name, target_ids (array)"
}
```

**Response (403 Forbidden):**
```json
{
  "error": "Access denied to one or more target projects",
  "reason": "Cannot copy to project TARGET — permission denied",
  "message": "Not authorized to write to target project"
}
```

**Response (500 Internal Error):**
```json
{
  "error": "Resource copy failed",
  "message": "..."
}
```

### POST /api/resources/copy-strategy

**Copy a strategy from one project to many.**

**Request Body:**
```json
{
  "source_id": "proj-a",
  "strategy_name": "deploy-pipeline",
  "target_ids": ["proj-b", "proj-c"]
}
```

**Responses:** Same structure as `/copy-methodology`.

---

## Implementation Notes

### Manifest Locking

The copy operation uses an advisory file lock to prevent concurrent writes. The lock is **not** a distributed lock — it only works within a single machine/bridge instance. For multi-instance deployments:

- Each bridge instance operates independently
- File locks are per-instance
- Concurrent copies from different bridge instances may still corrupt manifests
- **Mitigation:** Run a single bridge instance per environment, or implement distributed locking (future work)

### Atomic Writes

Manifests are written atomically using the temp-file + rename pattern:
1. Write to `manifest.yaml.tmp`
2. Atomic rename: `manifest.yaml.tmp` → `manifest.yaml`
3. On filesystem, rename is atomic (no partial writes)

This ensures manifests are either fully written or fully untouched—never partially corrupt.

### Source Project Exclusion

The UI modal excludes the source project from the target list. This prevents accidental self-copies:

```typescript
// In dashboard.html, filterProjectsForCopy()
const targetProjects = projects.filter(p => p.id !== sourceProjectId);
```

If you need to copy within the same project (rare), use the API directly:
```bash
curl -X POST http://localhost:3456/api/resources/copy-methodology \
  -d '{ "source_id": "proj-a", "method_name": "P2-SD", "target_ids": ["proj-a"] }'
```

---

## See Also

- **Guide 6:** Project Cards — Project manifest structure and metadata
- **Guide 13:** Installation — How methodologies are installed (related to copying)
- **Guide 16:** Strategy Pipelines — Creating and managing strategies (what you copy)
- **PRD 020 Phase 3:** Official requirement document for resource sharing

