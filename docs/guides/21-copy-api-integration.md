---
guide: 21
title: "Copy API Integration"
domain: multi-project
audience: [contributors]
summary: >-
  HTTP and MCP interfaces for copying methodologies and strategies between projects.
prereqs: [19, 20]
touches:
  - packages/bridge/src/resource-copier.ts
  - packages/bridge/src/project-routes.ts
  - packages/mcp/src/index.ts
---

# Guide 21 — Copy API Integration (PRD 020 Phase 3)

How to programmatically copy methodologies and strategies between projects. For developers building automation, CI/CD pipelines, and orchestration systems that distribute resources at scale.

## Quick Start

### Python Example

```python
import requests
import json

BRIDGE_URL = "http://localhost:3456"

def copy_methodology(source_id, method_name, target_ids):
    """Copy a methodology from source to multiple targets."""
    response = requests.post(
        f"{BRIDGE_URL}/api/resources/copy-methodology",
        headers={"Content-Type": "application/json"},
        json={
            "source_id": source_id,
            "method_name": method_name,
            "target_ids": target_ids
        }
    )

    if response.status_code == 200:
        results = response.json()
        successes = [r for r in results["copied_to"] if r["status"] == "success"]
        failures = [r for r in results["copied_to"] if r["status"] == "error"]

        print(f"✓ Copied to {len(successes)} projects")
        if failures:
            print(f"✗ Failed for {len(failures)} projects:")
            for f in failures:
                print(f"  - {f['project_id']}: {f.get('error_detail', 'unknown error')}")

        return results
    else:
        print(f"Error: {response.status_code}")
        print(response.json())
        raise Exception(f"Copy failed: {response.text}")

# Usage
results = copy_methodology(
    source_id="reference-proj",
    method_name="P2-SD",
    target_ids=["team-a-proj", "team-b-proj", "team-c-proj"]
)
```

### JavaScript / Node.js Example

```javascript
async function copyMethodology(sourceId, methodName, targetIds) {
  const response = await fetch('http://localhost:3456/api/resources/copy-methodology', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: sourceId,
      method_name: methodName,
      target_ids: targetIds
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Copy failed: ${error.error}`);
  }

  const results = await response.json();

  // Process results
  results.copied_to.forEach(result => {
    if (result.status === 'success') {
      console.log(`✓ ${result.project_id}`);
    } else {
      console.error(`✗ ${result.project_id}: ${result.error_detail}`);
    }
  });

  return results;
}

// Usage
await copyMethodology('reference-proj', 'P2-SD', [
  'team-a-proj',
  'team-b-proj',
  'team-c-proj'
]);
```

### Bash / cURL Example

```bash
#!/bin/bash
# Distribute methodology to all team projects

BRIDGE_URL="http://localhost:3456"
SOURCE="reference-proj"
METHOD="P2-SD"
TARGETS=("team-a-proj" "team-b-proj" "team-c-proj")

# Convert array to JSON
TARGETS_JSON=$(printf '"%s",' "${TARGETS[@]}" | sed 's/,$//')

curl -X POST "$BRIDGE_URL/api/resources/copy-methodology" \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "'"$SOURCE"'",
    "method_name": "'"$METHOD"'",
    "target_ids": ['"$TARGETS_JSON"']
  }' | jq '.copied_to[] | select(.status=="error") | .project_id'
```

---

## Use Cases

### 1. Distribute Approved Methodologies to New Projects

When creating a new project, automatically install your team's standard methodology:

```python
def bootstrap_new_project(new_project_id):
    """Set up a new project with standard methodologies."""

    standard_methodologies = [
        ("reference-proj", "P2-SD"),       # Software Delivery
        ("reference-proj", "RETRO-PROTO"), # Retrospectives
    ]

    for source_id, method_name in standard_methodologies:
        results = copy_methodology(source_id, method_name, [new_project_id])

        # Verify success
        if any(r["status"] == "error" for r in results["copied_to"]):
            raise Exception(f"Failed to install {method_name}")

    print(f"✓ {new_project_id} bootstrapped with standard methodologies")
```

### 2. Bulk Distribution Across Organization

Copy a methodology to all 50 team projects:

```python
def distribute_to_all_teams(method_name, source_id="reference-proj"):
    """Distribute methodology to all registered projects."""

    # Get list of all team projects from your project registry
    team_projects = [
        f"team-{i:02d}-proj" for i in range(1, 51)
    ]

    # Copy in batches to avoid overwhelming the bridge
    batch_size = 10
    for i in range(0, len(team_projects), batch_size):
        batch = team_projects[i:i+batch_size]
        print(f"Copying {method_name} to projects {i+1}-{i+len(batch)}...")

        results = copy_methodology(source_id, method_name, batch)

        failed_projects = [
            r["project_id"] for r in results["copied_to"]
            if r["status"] == "error"
        ]

        if failed_projects:
            print(f"  ⚠ Failed for: {', '.join(failed_projects)}")
            # Optionally log for manual review
```

### 3. GitOps / CI Pipeline Integration

Update all projects when a methodology changes:

```python
# Trigger via webhook or CI/CD hook
def sync_methodology_to_deployed_projects(method_name, version):
    """
    Called when a methodology is updated.
    Re-syncs the updated version to all deployed projects.
    """

    # Query which projects have this methodology
    projects_using_method = [
        # Query your project registry for projects with method_name
    ]

    # Re-copy with new version
    results = copy_methodology(
        source_id="methodology-registry",
        method_name=method_name,
        target_ids=projects_using_method
    )

    # Record sync result
    log_sync_event({
        "method_name": method_name,
        "version": version,
        "timestamp": datetime.now().isoformat(),
        "targets": len(projects_using_method),
        "succeeded": sum(1 for r in results["copied_to"] if r["status"] == "success"),
        "failed": sum(1 for r in results["copied_to"] if r["status"] == "error")
    })
```

### 4. Conditional Installation Based on Project Type

Install different methodologies for different project types:

```python
def setup_project_by_type(project_id, project_type):
    """Install methodologies appropriate for project type."""

    TEMPLATES = {
        "service": ["P2-SD", "RETRO-PROTO"],
        "library": ["P2-SD"],
        "infra": ["P1-EXEC", "RETRO-PROTO"],
    }

    methodologies = TEMPLATES.get(project_type, ["P2-SD"])

    for method in methodologies:
        copy_methodology("reference-proj", method, [project_id])

    print(f"✓ {project_id} ({project_type}) configured with {len(methodologies)} methodologies")
```

---

## Error Handling & Retry Logic

### Robust Retry Pattern

```python
import time
from typing import Optional

def copy_with_retry(
    source_id: str,
    method_name: str,
    target_ids: list,
    max_retries: int = 3,
    backoff_seconds: int = 2
):
    """Copy with exponential backoff retry."""

    last_exception = None

    for attempt in range(max_retries):
        try:
            response = requests.post(
                f"{BRIDGE_URL}/api/resources/copy-methodology",
                json={
                    "source_id": source_id,
                    "method_name": method_name,
                    "target_ids": target_ids
                },
                timeout=30
            )

            if response.status_code == 200:
                return response.json()

            # Retry on 5xx errors
            if 500 <= response.status_code < 600:
                raise Exception(f"Server error {response.status_code}")

            # Don't retry on 4xx (client error, won't succeed on retry)
            if 400 <= response.status_code < 500:
                raise Exception(f"Client error {response.status_code}: {response.json()}")

        except (requests.Timeout, requests.ConnectionError, Exception) as e:
            last_exception = e

            if attempt < max_retries - 1:
                wait_time = backoff_seconds * (2 ** attempt)
                print(f"Attempt {attempt+1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"All {max_retries} attempts failed.")

    raise last_exception
```

### Per-Target Retry (Partial Failure Recovery)

```python
def copy_with_partial_retry(source_id, method_name, target_ids):
    """Copy, then retry only failed targets."""

    results = copy_methodology(source_id, method_name, target_ids)

    failed_targets = [
        r["project_id"] for r in results["copied_to"]
        if r["status"] == "error"
    ]

    if failed_targets:
        print(f"Retrying {len(failed_targets)} failed targets...")
        time.sleep(2)  # Brief pause

        retry_results = copy_methodology(source_id, method_name, failed_targets)

        # Merge results
        results["copied_to"] = [
            r for r in results["copied_to"] if r["project_id"] not in failed_targets
        ] + retry_results["copied_to"]

    return results
```

### Handle Authorization Errors

```python
def copy_with_auth_check(source_id, method_name, target_ids, project_id=None):
    """Copy with authorization checks."""

    headers = {"Content-Type": "application/json"}
    if project_id:
        headers["x-project-id"] = project_id

    response = requests.post(
        f"{BRIDGE_URL}/api/resources/copy-methodology",
        headers=headers,
        json={
            "source_id": source_id,
            "method_name": method_name,
            "target_ids": target_ids
        }
    )

    if response.status_code == 403:
        error = response.json()
        print(f"Authorization denied: {error.get('reason')}")
        print("Possible causes:")
        print("  1. x-project-id header does not match the source project")
        print("  2. x-project-id header does not match one or more target projects")
        raise PermissionError(error.get('reason'))

    return response.json()
```

---

## Batch Operations

### Distribute to All Projects Matching a Pattern

```python
def copy_to_matching_projects(method_name, project_pattern, source_id="reference-proj"):
    """Copy methodology to all projects matching a name pattern."""

    import re

    # Get all projects
    all_projects = get_all_projects()

    # Filter by pattern
    pattern = re.compile(project_pattern)
    matching_projects = [p["id"] for p in all_projects if pattern.match(p["id"])]

    print(f"Found {len(matching_projects)} projects matching '{project_pattern}'")

    if not matching_projects:
        print("No projects found. Aborting.")
        return

    # Copy in batches
    batch_size = 5
    for i in range(0, len(matching_projects), batch_size):
        batch = matching_projects[i:i+batch_size]
        print(f"Batch {i//batch_size + 1}: copying to {', '.join(batch)}")

        results = copy_with_retry(source_id, method_name, batch)

        # Log batch result
        for result in results["copied_to"]:
            status = "✓" if result["status"] == "success" else "✗"
            print(f"  {status} {result['project_id']}")

# Usage: Copy P2-SD to all "team-" projects
copy_to_matching_projects("P2-SD", r"^team-.*")
```

### Parallel Distribution with Thread Pool

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def copy_parallel(source_id, method_name, target_ids, max_workers=5):
    """Copy to multiple projects in parallel (one project per thread)."""

    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                copy_with_retry,
                source_id,
                method_name,
                [target_id]
            ): target_id for target_id in target_ids
        }

        for future in as_completed(futures):
            target_id = futures[future]
            try:
                result = future.result()
                results.append(result)
                print(f"✓ {target_id}")
            except Exception as e:
                print(f"✗ {target_id}: {e}")

    return results

# Usage: Copy to 30 projects with 5 parallel workers
copy_parallel("reference-proj", "P2-SD", [f"proj-{i}" for i in range(30)], max_workers=5)
```

---

## Monitoring & Observability

### Log Copy Operations

```python
import json
from datetime import datetime

def log_copy_operation(source_id, method_name, target_ids, results, duration_seconds):
    """Log copy operation to audit trail."""

    event = {
        "timestamp": datetime.utcnow().isoformat(),
        "operation": "copy_methodology",
        "source_id": source_id,
        "method_name": method_name,
        "target_count": len(target_ids),
        "success_count": sum(1 for r in results["copied_to"] if r["status"] == "success"),
        "failure_count": sum(1 for r in results["copied_to"] if r["status"] == "error"),
        "duration_seconds": duration_seconds,
        "failed_targets": [
            r["project_id"] for r in results["copied_to"]
            if r["status"] == "error"
        ]
    }

    # Write to audit log
    with open("/var/log/method-copy-audit.jsonl", "a") as f:
        f.write(json.dumps(event) + "\n")

    # Send to monitoring
    if event["failure_count"] > 0:
        alert(f"Copy operation had {event['failure_count']} failures", event)
```

### Metrics Dashboard

```python
def get_copy_metrics(hours=24):
    """Get copy operation metrics from audit log."""

    import json
    from datetime import datetime, timedelta

    cutoff = datetime.utcnow() - timedelta(hours=hours)

    total_ops = 0
    total_targets = 0
    total_successes = 0
    total_failures = 0

    with open("/var/log/method-copy-audit.jsonl", "r") as f:
        for line in f:
            event = json.loads(line)
            event_time = datetime.fromisoformat(event["timestamp"])

            if event_time >= cutoff:
                total_ops += 1
                total_targets += event["target_count"]
                total_successes += event["success_count"]
                total_failures += event["failure_count"]

    print(f"Last {hours} hours:")
    print(f"  Operations: {total_ops}")
    print(f"  Total targets: {total_targets}")
    print(f"  Success rate: {total_successes}/{total_targets} ({100*total_successes/total_targets:.1f}%)")
    print(f"  Failures: {total_failures}")
```

---

## Concurrency & Performance

### Safe Concurrent Copies

The copy API is **safe for concurrent use** within a single bridge instance:

```python
import asyncio
import aiohttp

async def copy_many_concurrent(source_id, method_name, target_ids):
    """Copy to many targets concurrently (within limits)."""

    async with aiohttp.ClientSession() as session:
        tasks = [
            copy_one(session, source_id, method_name, [tid])
            for tid in target_ids
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    return results

async def copy_one(session, source_id, method_name, target_ids):
    async with session.post(
        f"{BRIDGE_URL}/api/resources/copy-methodology",
        json={
            "source_id": source_id,
            "method_name": method_name,
            "target_ids": target_ids
        }
    ) as resp:
        return await resp.json()
```

### Performance Characteristics

| Operation | Typical Duration | Scaling |
|-----------|------------------|---------|
| Copy to 1 target | 50-100ms | O(1) |
| Copy to 5 targets | 200-300ms | O(n) |
| Copy to 50 targets | 2-3s | O(n) |
| Manifest lock timeout | 1s | Fixed |

**Optimization tips:**
- Copy to 10-20 targets per request (don't batch 100+ in one call)
- Use thread/async parallelism for distributing to many projects
- Retry failed targets rather than re-copying everything

---

## Deployment Considerations

### Bridge Availability

The copy API requires the bridge to be running. For critical workflows:

```python
def ensure_bridge_available(timeout_seconds=10):
    """Check bridge is running before attempting copy."""

    import time
    start = time.time()

    while time.time() - start < timeout_seconds:
        try:
            response = requests.get(f"{BRIDGE_URL}/health", timeout=2)
            if response.status_code == 200:
                return True
        except:
            time.sleep(0.5)

    raise RuntimeError(f"Bridge not available at {BRIDGE_URL}")

# Usage
try:
    ensure_bridge_available()
    results = copy_methodology(...)
except RuntimeError:
    print("Error: Bridge is down. Cannot proceed with copy.")
```

### Session Context

The bridge uses the `x-project-id` header for session context (no Bearer token authentication). `getSessionContext()` reads only this header. If the header is set, `validateProjectAccess` checks that it matches the requested project ID. If omitted, read-only discovery access is allowed.

```python
def copy_with_session_context(source_id, method_name, target_ids, project_id=None):
    """Copy with session context via x-project-id header."""

    headers = {"Content-Type": "application/json"}

    if project_id:
        headers["x-project-id"] = project_id

    response = requests.post(
        f"{BRIDGE_URL}/api/resources/copy-methodology",
        headers=headers,
        json={
            "source_id": source_id,
            "method_name": method_name,
            "target_ids": target_ids
        }
    )

    if response.status_code == 403:
        error = response.json()
        raise PermissionError(error.get('reason', 'Access denied'))

    return response.json()
```

---

## See Also

- **Guide 20:** Resource Sharing — UI and operational guide
- **Guide 13:** Installation — How methodologies are installed
- **API Reference:** `/api/resources/copy-methodology` and `/api/resources/copy-strategy` endpoints

