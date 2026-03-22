# Resource Copy

## Responsibility

Resource Copy implements atomic copying of methodologies and strategies between projects. It reads compiled YAML entries from a source project's manifest, validates the target projects, and registers the copied entries in target manifests without partial failures or corruption.

**Key constraints:**
- Copy operations are atomic: all-or-nothing per target (lock, read, edit, write, unlock)
- Path validation prevents directory traversal attacks (realpathSync check against project root)
- Manifest structure is validated with Zod schema before any writes
- Partial copy failure (e.g., 3 of 5 targets succeed) is logged with per-target error details
- No cascade changes — copying does not modify any other project files or registries

### Relationship to Project Discovery

Resource Copy is triggered by MCP tools `resource_copy_methodology` and `resource_copy_strategy`. These are called by Genesis or orchestration agents after discovering projects via `project_list`. The source methodology or strategy is located in the source project's compiled registry, and the MCP tools invoke the copy functions with project IDs resolved by the discovery service.

## File Structure

```
packages/bridge/src/
├── resource-copier.ts        Copy logic (copyMethodology, copyStrategy)
├── resource-copier-routes.ts HTTP routes for copy endpoints
└── __tests__/
    └── resource-copier.test.ts Unit tests for copy paths, lock, validation

packages/core/src/
└── mcp-tools/
    └── resource-copy-tools.ts MCP tool definitions + request handlers
```

## Data Flow

### Methodology Copy

```
POST /methodology/copy
  ├─ Validate request: source_id, method_name, target_ids[]
  ├─ resolveProjectPath(source_id) → source project directory
  ├─ loadManifest(sourcePath) → source manifest YAML
  ├─ findInstalledEntry(manifest, method_name, 'methodology') → methodology entry
  │
  └─ for each target_id:
      ├─ resolveProjectPath(target_id) → target directory
      ├─ validateTargetExists(targetPath) — check .git/ directory
      ├─ acquireManifestLock(targetPath) — F-R-2: advisory lock, 10 retries × 100ms
      ├─ loadManifest(targetPath) → target manifest (or create new)
      ├─ validateConfig(targetManifest) — Zod schema check
      ├─ findInstalledEntry(targetManifest, method_name, 'methodology') → index
      ├─ if exists: replace entry at index
      │  else:    append new entry
      ├─ update manifest.last_updated timestamp
      ├─ saveManifest() [atomic: temp file + rename]
      ├─ releaseManifestLock(targetPath)
      └─ record result (success | error + detail)

Response 200
  {
    "copied_to": [
      { "project_id": "proj1", "status": "success" },
      { "project_id": "proj2", "status": "error", "error_detail": "..." },
      ...
    ]
  }
```

### Strategy Copy

Identical flow, but searching for entries with `type: 'strategy'` instead of `type: 'methodology'`.

## Type Definitions

### Request Types

```typescript
interface CopyMethodologyRequest {
  source_id: string;       // Project ID (directory name or path)
  method_name: string;     // Methodology ID (e.g., "P2-SD")
  target_ids: string[];    // Target project IDs
}

interface CopyStrategyRequest {
  source_id: string;
  strategy_name: string;   // Strategy ID (e.g., "S-CODE-REVIEW")
  target_ids: string[];
}
```

### Response Types

```typescript
interface CopyResult {
  project_id: string;
  status: 'success' | 'error';
  error_detail?: string;   // Present only on error
}

interface CopyResponse {
  copied_to: CopyResult[];  // One entry per target
}
```

### Manifest Structure

```typescript
interface ManifestSchema {
  manifest: {
    project: string;           // Project ID
    last_updated: string;      // ISO date YYYY-MM-DD
    installed: Array<{
      id: string;              // Methodology/strategy ID
      type: 'methodology' | 'protocol' | 'strategy';
      version: string;         // Version string
      card?: string;           // Project card path (optional)
      card_version?: string;   // Card version (optional)
      instance_id?: string;    // Instance ID for protocols (optional)
      artifacts?: string[];    // Artifact file paths (optional)
      status?: 'draft' | 'promoted' | 'active';
      extends?: string;        // Parent ID for extending (optional)
    }>;
  };
}
```

## Path Resolution

### resolveProjectPath(projectId, rootDir)

Converts a project ID to an absolute filesystem path:

1. **Special cases:**
   - `projectId === 'root'` or `projectId === '.'` → return rootDir
2. **If projectId contains `/` or `\`:**
   - Treat as relative path, resolve against process cwd: `path.resolve(projectId)`
3. **Otherwise:**
   - Treat as sibling directory in rootDir: `path.resolve(rootDir, projectId)`

**No traversal attacks:** Paths are resolved to absolute form; symlink checking and `.git` validation ensure targets are git repositories.

### Target Validation

```typescript
function validateTargetExists(targetPath: string): boolean {
  // Check .git directory exists (ensures it's a git repo)
  return fs.existsSync(path.join(targetPath, '.git'));
}
```

## Manifest Locking

Advisory file locking prevents concurrent writes to the same manifest:

```typescript
function acquireManifestLock(projectPath: string): boolean {
  const lockPath = path.join(projectPath, '.method', '.manifest.lock');
  let retries = 10;

  while (fs.existsSync(lockPath) && retries-- > 0) {
    // Busy-wait 100ms
    const start = Date.now();
    while (Date.now() - start < 100) {}
  }

  if (fs.existsSync(lockPath)) {
    return false;  // Lock timeout after 1 second
  }

  fs.writeFileSync(lockPath, Date.now().toString(), 'utf-8');
  return true;
}

function releaseManifestLock(projectPath: string): void {
  const lockPath = path.join(projectPath, '.method', '.manifest.lock');
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Ignore cleanup errors
  }
}
```

**Key invariants:**
- Lock is held for the entire read-validate-write-update cycle
- Lock acquisition has a 1-second timeout (10 retries × 100ms)
- Lock failure is reported as error for that target (operation fails gracefully, other targets unaffected)
- Lock is always released in a finally block to prevent deadlock

## Validation

All manifest entries are validated against the Zod schema before any write:

```typescript
function validateConfig(config: any): { valid: boolean; errors: string[] } {
  try {
    ManifestSchema.parse(config);
    return { valid: true, errors: [] };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        valid: false,
        errors: err.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      };
    }
    return { valid: false, errors: [err.message] };
  }
}
```

**Validation gates:**
- Manifest structure must match schema
- All required fields (`manifest.project`, `manifest.last_updated`, `manifest.installed`) must be present
- `installed` must be an array of valid entries
- Each entry must have `id`, `type` (enum), and `version`

If validation fails, the manifest is not written and an error is returned.

## Atomic Writes

Manifest writes use atomic rename to prevent partial writes on crash:

```typescript
const tempPath = `${manifestPath}.tmp`;
fs.writeFileSync(tempPath, yamlContent, 'utf-8');
fs.renameSync(tempPath, manifestPath);  // Atomic on POSIX/Windows
```

**Key invariants:**
- If process crashes during write, only the `.tmp` file is lost (manifest is unmodified)
- If process crashes during rename, one of the two files exists (manifest or temp)
- In recovery, if `.tmp` exists, it's considered abandoned and deleted

## Error Handling

### Per-Target Error Reporting

Each target in the `copied_to` array includes status and optional error detail:

```typescript
// Success
{ project_id: "proj1", status: "success" }

// Error cases
{ project_id: "proj2", status: "error", error_detail: "Source not found or invalid" }
{ project_id: "proj3", status: "error", error_detail: "Target project not found" }
{ project_id: "proj4", status: "error", error_detail: "Failed to acquire manifest lock" }
{ project_id: "proj5", status: "error", error_detail: "Manifest validation failed: ..." }
```

### HTTP-level Errors

| Status | Condition |
|--------|-----------|
| 200 | All or partial success (check `copied_to[].status`) |
| 400 | Invalid request (missing required fields) |
| 404 | Source project not found |
| 409 | Manifest lock timeout for all targets |
| 500 | Unexpected server error |

## Dependencies

| Module | Purpose |
|--------|---------|
| `fs`, `path` | File I/O and path resolution |
| `js-yaml` | YAML parsing and serialization |
| `zod` | Manifest schema validation |
| `discovery-service` | Project listing and resolution |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `COPY_LOCK_TIMEOUT_MS` | `1000` | Lock acquisition timeout (10 × 100ms) |
| `COPY_LOCK_RETRY_MS` | `100` | Backoff between lock retries |
| `COPY_MAX_MANIFEST_SIZE_BYTES` | `1048576` | Max manifest file size (1 MB) |

## Key Design Decisions

### Why Atomic Writes?

Partial manifest writes on crash would corrupt the YAML file, breaking all future copy operations. Atomic rename guarantees that readers always see a consistent manifest — either the old one or the new one, never partial.

### Why Zod Validation?

Zod enforces manifest schema at write time, catching malformed entries before they're persisted. This prevents cascading errors downstream (e.g., when Genesis tries to load an invalid methodology entry). Validation is fast and happens in-process.

### Why Advisory Locking?

Mandatory locking would require OS support (not portable). Advisory locking is cooperative — it prevents concurrent modifications within the bridge's process space. For cross-process concurrency (e.g., multiple bridge instances), explicit consensus or distributed locks would be needed (future enhancement).

### Why Per-Target Results?

When copying to multiple targets, partial success is common (e.g., 2 of 3 succeed). Returning per-target status allows clients to retry failed targets without re-processing successful ones. A fail-fast response would require all-or-nothing semantics, forcing rollback on any error.

## Related Files

- **`packages/bridge/src/resource-copier.ts`** — Copy implementation (copyMethodology, copyStrategy)
- **`packages/bridge/src/resource-copier-routes.ts`** — HTTP endpoint handlers
- **`packages/bridge/src/config/config-reloader.ts`** — Zod validation schema
- **`packages/core/src/mcp-tools/resource-copy-tools.ts`** — MCP tool definitions
- **`registry/`** — Source YAML files (read-only during copy)
