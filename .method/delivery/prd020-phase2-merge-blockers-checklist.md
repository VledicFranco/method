# PRD 020 Phase 2 — Merge Blockers Checklist

**Status:** READY FOR FIXES
**Total Blockers:** 11
**Estimated Effort:** 17 hours (2 engineers × 1 week or 4 engineers × 2-3 days)
**Owner:** Bridge & QA Team

---

## BLOCKER 1: F-A-1 — Genesis Tools Not Registered in MCP

**Severity:** CRITICAL | **Effort:** 2 hours | **Owner:** Bridge engineer

**The Problem:**
Genesis tools are fully implemented (`genesis-tools.ts`) with validation, input schemas, and authorization checks. However, none of these 5 tools are registered in the MCP tool surface (`packages/mcp/src/index.ts`). As a result, Genesis can spawn and connect, but has **zero executable tools** — making the feature completely non-functional.

**Files Affected:**
- `packages/mcp/src/index.ts` (MCP tool registry)
- `packages/mcp/src/genesis-tools.ts` (tool definitions — already complete)
- `packages/bridge/src/genesis/polling-loop.ts` (expects eventFetcher callback)

**Fix Checklist:**

- [ ] **Task 1: Register 5 tools in ListToolsRequestSchema (lines 99-750)**
  ```typescript
  // Add these 5 tool definitions:
  - project_list (read-only, requires Genesis privilege)
  - project_get (read-only, requires Genesis privilege)
  - project_get_manifest (read-only, requires Genesis privilege)
  - project_read_events (read-only, requires Genesis privilege)
  - genesis_report (output channel, requires Genesis privilege)
  ```
  - [ ] Verify each tool has name, description, inputSchema, outputSchema
  - [ ] Match schema structure to existing tools (e.g., resource_copy_methodology)

- [ ] **Task 2: Add 5 case handlers in CallToolRequestSchema (lines 762+)**
  ```typescript
  // Add these 5 cases:
  case 'project_list': { /* handler */ }
  case 'project_get': { /* handler */ }
  case 'project_get_manifest': { /* handler */ }
  case 'project_read_events': { /* handler */ }
  case 'genesis_report': { /* handler */ }
  ```
  - [ ] Each handler validates input using Zod schema
  - [ ] Each handler enforces Genesis privilege (enforceGenesisPrivilege)
  - [ ] Handlers return proper response schema

- [ ] **Task 3: Wire project_read_events to bridge HTTP endpoint**
  - [ ] Create bridge route: `GET /api/events?since=<cursor>&projectId=<projectId>`
  - [ ] Return: `{ events: [], nextCursor: string }`
  - [ ] Verify polling loop can call this endpoint

- [ ] **Task 4: Wire genesis_report to channels/events endpoint**
  - [ ] Reuse existing `POST /api/events` or create Genesis-specific endpoint
  - [ ] Accept: `{ type: string, message: string, metadata?: {} }`
  - [ ] Write to event log for dashboard consumption

- [ ] **Task 5: Run tests**
  ```bash
  npm run test -- packages/mcp/__tests__/genesis-tools.test.ts
  npm run test -- packages/bridge/__tests__/genesis-routes.test.ts
  ```
  - [ ] genesis-tools tests: ALL PASS
  - [ ] genesis-routes tests: ALL PASS
  - [ ] New integration test: spawn Genesis, call project_list, verify response

---

## BLOCKER 2: F-A-3 — Genesis Polling Loop Never Started

**Severity:** CRITICAL | **Effort:** 3 hours | **Owner:** Bridge engineer

**The Problem:**
`GenesisPollingLoop` class is fully implemented (polling-loop.ts:135-248) with proper lifecycle management (start, stop, pollOnce). However, it's **never instantiated or started** in the bridge initialization. Bridge spawns Genesis (index.ts:896) but discards the session ID without starting the polling loop. As a result, Genesis is idle — it never observes project events.

**Files Affected:**
- `packages/bridge/src/index.ts` (bridge initialization, line 896)
- `packages/bridge/src/genesis/polling-loop.ts` (loop implementation)
- `packages/bridge/src/genesis/spawner.ts` (return value discarded)
- `packages/bridge/src/genesis-routes.ts` (route context missing polling loop reference)

**Fix Checklist:**

- [ ] **Task 1: Instantiate GenesisPollingLoop in index.ts**
  ```typescript
  // After line 896 where Genesis is spawned:
  const pollingLoop = new GenesisPollingLoop({
    intervalMs: GENESIS_POLL_MS || 5000,
    cursorFilePath: path.join('.method', 'genesis-cursors.yaml'),
  });
  ```
  - [ ] Import GenesisPollingLoop from genesis/polling-loop.ts
  - [ ] Store in module scope or app context
  - [ ] Make available to genesis-routes.ts

- [ ] **Task 2: Wire eventFetcher callback to project_read_events**
  ```typescript
  const eventFetcher = async (projectId: string, cursor: string) => {
    // Call project_read_events MCP tool (or bridge endpoint)
    const response = await bridgeClient.call('project_read_events', {
      projectId,
      since: cursor,
    });
    return response.events;
  };
  ```
  - [ ] Verify callback signature matches polling loop expectations
  - [ ] Handle errors gracefully (log, don't crash polling loop)

- [ ] **Task 3: Wire onNewEvents callback**
  ```typescript
  const onNewEvents = async (projectId: string, events: ProjectEvent[]) => {
    // Emit to event channels for dashboard
    for (const event of events) {
      eventLog.push(event);
      await emitEventToChannels(event);
    }
  };
  ```
  - [ ] Reuse existing event emitter infrastructure
  - [ ] Update cursor after events processed
  - [ ] Handle backpressure (don't queue indefinitely)

- [ ] **Task 4: Start polling loop after Genesis spawns**
  ```typescript
  pollingLoop.start(
    genesisSessionId,
    sessionPool,
    eventFetcher,
    onNewEvents,
  );
  ```
  - [ ] Verify Genesis session is fully initialized before starting
  - [ ] Log: "Genesis polling loop started: interval=5000ms"

- [ ] **Task 5: Stop polling loop on graceful shutdown**
  ```typescript
  // In gracefulShutdown():
  if (pollingLoop && pollingLoop.isRunning()) {
    pollingLoop.stop();
    await pollingLoop.saveCursors(); // ensure persisted
  }
  ```
  - [ ] Ensure polling loop stops before bridge exits
  - [ ] Cursor file is saved atomically
  - [ ] No orphaned polling intervals

- [ ] **Task 6: Make pollingLoop available to genesis-routes.ts**
  ```typescript
  // In genesis-routes.ts context:
  const context = { pollingLoop, genesisSessionId, sessionPool };
  app.register(genesisRoutes, { context });
  ```
  - [ ] Routes can access pollingLoop for status queries
  - [ ] Test: GET /api/genesis/status returns polling loop state

- [ ] **Task 7: Run tests**
  ```bash
  npm run test -- packages/bridge/__tests__/genesis-spawner.test.ts
  npm run test -- packages/bridge/__tests__/genesis-polling-loop.test.ts
  ```
  - [ ] Spawner tests: Genesis spawns successfully
  - [ ] Polling loop tests: start/stop lifecycle works
  - [ ] New integration test: spawn Genesis → polling loop starts → observes events

---

## BLOCKER 3: F-P-1 — Event Log Unbounded Growth

**Severity:** CRITICAL | **Effort:** 2 hours | **Owner:** Bridge engineer

**The Problem:**
Global `eventLog: ProjectEvent[]` array accumulates all events since bridge startup with **no archival, truncation, or TTL-based cleanup**. Under high load (100 projects × 5 events/sec), the bridge accumulates 43M events in 24 hours (~2.16 GB), causing OOM crash. The feature is time-bomb unstable.

**Files Affected:**
- `packages/bridge/src/project-routes.ts` (line 37: `eventLog` declaration)
- `packages/bridge/src/project-routes.ts` (lines 346, 474: event push operations)
- `packages/bridge/src/genesis/polling-loop.ts` (onNewEvents callback)

**Fix Checklist:**

- [ ] **Task 1: Add MAX_EVENTS config**
  ```typescript
  const MAX_EVENTS_IN_MEMORY = parseInt(process.env.MAX_EVENTS || '10000');
  ```
  - [ ] Environment variable `MAX_EVENTS` (default 10000)
  - [ ] Configurable per deployment

- [ ] **Task 2: Implement ring buffer pruning**
  ```typescript
  function addEventToLog(event: ProjectEvent): void {
    eventLog.push(event);

    // Prune if over capacity
    if (eventLog.length > MAX_EVENTS_IN_MEMORY) {
      const removed = eventLog.splice(0, 1000); // remove oldest 1000
      console.log(`Event log pruned: removed ${removed.length}, size now ${eventLog.length}`);
    }
  }
  ```
  - [ ] Keep last N events (most recent)
  - [ ] Remove oldest 10% when capacity exceeded
  - [ ] Log pruning action with removed count

- [ ] **Task 3: Replace direct array push with addEventToLog**
  - [ ] Find all `eventLog.push(event)` calls
  - [ ] Replace with `addEventToLog(event)`
  - [ ] Verify cursor generation still works (cursorMap references index)

- [ ] **Task 4: Add monitoring metric**
  ```typescript
  // Every 5 minutes:
  setInterval(() => {
    console.log(`[metrics] eventLog.length=${eventLog.length} cursorMap.size=${cursorMap.size}`);
  }, 5 * 60 * 1000);
  ```
  - [ ] Operators can monitor event log growth
  - [ ] Alert if approaching capacity

- [ ] **Task 5: Test with high event volume**
  ```bash
  npm run test -- packages/bridge/__tests__/event-log-capacity.test.ts
  ```
  - [ ] Generate 100 events/sec for 1 hour
  - [ ] Verify memory stays constant (ring buffer working)
  - [ ] Verify cursors still work after pruning
  - [ ] Verify dashboard can read events from trimmed log

---

## BLOCKER 4: F-P-2 — Cursor Map Unbounded Leak

**Severity:** CRITICAL | **Effort:** 1 hour | **Owner:** Bridge engineer

**The Problem:**
Cursor cleanup logic (lines 43-48) only runs **during other clients' generateCursor() calls**. If usage is bursty (e.g., 9-5 workday), cleanup gaps occur, and cursors leak for 24 hours. After 1 month, 28+ MB of stale cursors accumulate. While lower impact than event log, same design flaw.

**Files Affected:**
- `packages/bridge/src/project-routes.ts` (lines 36, 39-51: cursorMap + cleanup)

**Fix Checklist:**

- [ ] **Task 1: Add interval-based cleanup every 60 seconds**
  ```typescript
  function cleanupStaleCursors(): void {
    const now = Date.now();
    const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    let removed = 0;
    for (const [id, state] of cursorMap.entries()) {
      if (now - state.timestamp > TTL_MS) {
        cursorMap.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`Cursor cleanup: removed ${removed}, size now ${cursorMap.size}`);
    }
  }

  // Start cleanup interval on bridge init
  setInterval(cleanupStaleCursors, 60 * 1000);
  ```
  - [ ] Active cleanup every 60 seconds (not reactive)
  - [ ] Still remove >24h old cursors
  - [ ] Log cleanup actions

- [ ] **Task 2: Implement LRU eviction bound**
  ```typescript
  const MAX_CURSORS = 1000;

  function generateCursor(index: number): string {
    const cursorId = Math.random().toString(36).slice(2);
    cursorMap.set(cursorId, { eventIndex: index, timestamp: Date.now() });

    // If over capacity, evict oldest
    if (cursorMap.size > MAX_CURSORS) {
      let oldest = null;
      let oldestTime = Infinity;

      for (const [id, state] of cursorMap.entries()) {
        if (state.timestamp < oldestTime) {
          oldestTime = state.timestamp;
          oldest = id;
        }
      }

      if (oldest) {
        cursorMap.delete(oldest);
        console.log(`Cursor evicted (LRU): ${oldest}, size now ${cursorMap.size}`);
      }
    }

    return cursorId;
  }
  ```
  - [ ] Max 1000 cursors in memory
  - [ ] Evict oldest by timestamp (LRU)
  - [ ] Log evictions for visibility

- [ ] **Task 3: Test cursor lifecycle**
  ```bash
  npm run test -- packages/bridge/__tests__/cursor-lifecycle.test.ts
  ```
  - [ ] Generate 100 concurrent cursors
  - [ ] Verify map size stays ≤1000
  - [ ] Verify 24h+ old cursors cleaned up
  - [ ] Verify LRU eviction on overflow

---

## BLOCKER 5: F-NIKA-1 — Genesis Cannot Execute Read-Only Tools

**Severity:** CRITICAL | **Effort:** 1 hour | **Owner:** Bridge engineer

**The Problem:**
PRD says Genesis is "report-only" (OBSERVE, no mutations), but Phase 2 lists `project_copy_methodology` as an available tool. If Genesis has access, it violates the isolation constraint. The `enforceGenesisPrivilege()` check exists but may not be enforced on all tools.

**Files Affected:**
- `packages/bridge/src/genesis-tools.ts` (privilege enforcement)
- `packages/mcp/src/index.ts` (tool registration)
- `packages/bridge/src/__tests__/genesis-tools.test.ts` (privilege tests)

**Fix Checklist:**

- [ ] **Task 1: Audit all tools callable by Genesis**
  - [ ] `project_list` → read-only ✓ (allowed)
  - [ ] `project_get` → read-only ✓ (allowed)
  - [ ] `project_get_manifest` → read-only ✓ (allowed)
  - [ ] `project_read_events` → read-only ✓ (allowed)
  - [ ] `genesis_report` → output channel ✓ (allowed)
  - [ ] `project_copy_methodology` → **MUTATION** ✗ (deny)
  - [ ] `resource_copy_strategy` → **MUTATION** ✗ (deny)
  - [ ] `resource_copy_methodology` → **MUTATION** ✗ (deny)

- [ ] **Task 2: Implement enforceGenesisPrivilege for all tools**
  ```typescript
  function enforceGenesisPrivilege(sessionId: string, toolName: string): boolean {
    const readOnlyTools = [
      'project_list',
      'project_get',
      'project_get_manifest',
      'project_read_events',
      'genesis_report',
    ];

    // Check if session is Genesis
    const session = sessionPool.get(sessionId);
    if (!session.isGenesis) {
      return true; // Non-Genesis can call anything
    }

    // Genesis can only call read-only tools
    if (!readOnlyTools.includes(toolName)) {
      throw new Error(`Genesis denied access to mutation tool: ${toolName}`);
    }

    return true;
  }
  ```
  - [ ] Check on EVERY tool call, not just some
  - [ ] Whitelist read-only tools
  - [ ] Reject mutations with 403 Forbidden

- [ ] **Task 3: Add privilege enforcement to MCP handlers**
  - [ ] In `CallToolRequestSchema`, before calling any tool:
    ```typescript
    enforceGenesisPrivilege(sessionId, toolName);
    ```
  - [ ] All 5 mutation tools checked
  - [ ] Test each tool separately

- [ ] **Task 4: Run privilege tests**
  ```bash
  npm run test -- packages/bridge/__tests__/genesis-privilege.test.ts
  ```
  - [ ] Genesis can call read-only tools (200 OK)
  - [ ] Genesis cannot call mutations (403 Forbidden)
  - [ ] Non-Genesis can call anything (backward compat)
  - [ ] Test all 8 tools

---

## BLOCKER 6: F-THANE-2 — project-config.yaml Not Initialized

**Severity:** HIGH | **Effort:** 1.5 hours | **Owner:** Bridge engineer

**The Problem:**
When bridge discovers a new project, it creates `.method/` directory but doesn't initialize `project-config.yaml`. Discovered projects sit empty, making them unusable. Genesis can't reason about project metadata (owner, version, dependencies).

**Files Affected:**
- `packages/bridge/src/discovery/project-discovery.ts` (discover method)
- `packages/core/src/config/project-config-schema.ts` (schema)

**Fix Checklist:**

- [ ] **Task 1: Add project-config.yaml template**
  ```typescript
  function generateDefaultProjectConfig(projectId: string): ProjectConfig {
    return {
      projectId,
      repositoryName: projectId,
      owner: 'unassigned',
      version: '1.0',
      dependencies: [],
      shared_with: [],
      genesis_enabled: false,
      genesis_budget: 50000,
      resource_copy: false,
    };
  }
  ```
  - [ ] Use git metadata for projectId (from .git/config or dir name)
  - [ ] Set owner = 'unassigned' (human-editable marker)
  - [ ] Set genesis_enabled = false (opt-in)

- [ ] **Task 2: Initialize config on discovery**
  ```typescript
  async discover(rootDir: string): Promise<DiscoveryResult> {
    const projects: ProjectMetadata[] = [];

    for (const projectDir of projectDirs) {
      // ... existing discovery logic ...

      const methodDir = path.join(projectDir, '.method');
      await mkdirRecursive(methodDir);

      // NEW: Initialize project-config.yaml if missing
      const configPath = path.join(methodDir, 'project-config.yaml');
      if (!fs.existsSync(configPath)) {
        const config = generateDefaultProjectConfig(projectId);
        fs.writeFileSync(configPath, yaml.dump(config));
        console.log(`Initialized: ${configPath}`);
      }

      projects.push({ projectId, ... });
    }

    return { projects, ... };
  }
  ```
  - [ ] Check for existing config before overwriting
  - [ ] Use fs.writeFileSync (atomic for single file)
  - [ ] Log initialization

- [ ] **Task 3: Add marker comment**
  ```yaml
  # Auto-generated on discovery — edit as needed
  projectId: my-project
  repositoryName: my-project
  owner: unassigned
  version: "1.0"
  dependencies: []
  shared_with: []
  genesis_enabled: false
  genesis_budget: 50000
  resource_copy: false
  ```
  - [ ] Hint that file is editable
  - [ ] Comment explains each field

- [ ] **Task 4: Test discovery initialization**
  ```bash
  npm run test -- packages/bridge/__tests__/project-discovery.test.ts
  ```
  - [ ] Discover new project
  - [ ] Verify project-config.yaml exists
  - [ ] Verify projectId populated correctly
  - [ ] Verify owner = 'unassigned'
  - [ ] Verify no errors on re-discovery (don't overwrite existing)

---

## BLOCKER 7: F-THANE-4 — No E2E Portfolio Discovery Test

**Severity:** HIGH | **Effort:** 2 hours | **Owner:** QA engineer

**The Problem:**
PRD Phase 1 success criteria require "discover all projects, initialize .method/ in each." No integration test validates this end-to-end. Phase 1 deliverable is unvalidated.

**Files Affected:**
- `packages/bridge/src/__tests__/integration/` (new test file)

**Fix Checklist:**

- [ ] **Task 1: Create test file**
  ```bash
  touch packages/bridge/src/__tests__/integration/e2e-discovery.test.ts
  ```

- [ ] **Task 2: Set up temporary test projects**
  ```typescript
  describe('E2E: Portfolio Discovery', () => {
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = await createTempDir();

      // Create 3 mock git repos
      await setupGitRepo(path.join(tempRoot, 'projectA'));
      await setupGitRepo(path.join(tempRoot, 'projectB'));
      await setupGitRepo(path.join(tempRoot, 'projectC'));
    });

    afterAll(async () => {
      await removeTempDir(tempRoot);
    });
  ```
  - [ ] Create 3 separate git repos with different names
  - [ ] Each has .git/ directory
  - [ ] Cleanup after test

- [ ] **Task 3: Test discovery**
  ```typescript
  it('discovers all projects and initializes .method/', async () => {
    const result = await discoveryService.discover(tempRoot);

    // Verify discovery found all 3
    expect(result.projects).toHaveLength(3);
    expect(result.projects.map(p => p.projectId)).toEqual(
      expect.arrayContaining(['projectA', 'projectB', 'projectC'])
    );

    // Verify .method/ created in each
    for (const project of result.projects) {
      const methodDir = path.join(tempRoot, project.projectId, '.method');
      expect(fs.existsSync(methodDir)).toBe(true);

      // Verify project-config.yaml exists
      const configPath = path.join(methodDir, 'project-config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);

      // Verify projectId populated
      const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
      expect(config.projectId).toBe(project.projectId);
    }
  });
  ```
  - [ ] All 3 projects discovered
  - [ ] .method/ exists in each
  - [ ] project-config.yaml exists and populated
  - [ ] projectId matches discovery result

- [ ] **Task 4: Run test**
  ```bash
  npm run test -- packages/bridge/src/__tests__/integration/e2e-discovery.test.ts
  ```
  - [ ] Test PASSES

---

## BLOCKER 8: F-NIKA-6 — Cross-Project Isolation Not Validated

**Severity:** HIGH | **Effort:** 1 hour | **Owner:** QA engineer

**The Problem:**
Phase 1 defers project_copy_methodology to Phase 3, so copying tests are deferred. However, without isolation tests, we don't know if project manifests leak across projects. This is a blind spot that could hide bugs.

**Files Affected:**
- `packages/core/src/__tests__/` (new test file)

**Fix Checklist:**

- [ ] **Task 1: Create test file**
  ```bash
  touch packages/core/src/__tests__/project-isolation.test.ts
  ```

- [ ] **Task 2: Create 2 mock projects with different manifests**
  ```typescript
  describe('Project Isolation', () => {
    it('project manifests do not leak across projects', () => {
      // Project A with specific methodologies
      const configA = {
        projectId: 'projectA',
        manifest: {
          installed: [
            { methodology_id: 'P1-EXEC', version: '1.1' },
          ],
        },
      };

      // Project B with different methodologies
      const configB = {
        projectId: 'projectB',
        manifest: {
          installed: [
            { methodology_id: 'P2-SD', version: '2.0' },
          ],
        },
      };

      // Load registries separately
      const registryA = new ProjectRegistry(configA);
      const registryB = new ProjectRegistry(configB);

      // Verify registries are isolated
      expect(registryA.getInstalledMethodologies().map(m => m.methodology_id))
        .toEqual(['P1-EXEC']);
      expect(registryB.getInstalledMethodologies().map(m => m.methodology_id))
        .toEqual(['P2-SD']);

      // Verify no cross-contamination
      expect(registryA.getInstalledMethodologies()).not.toContainEqual(
        expect.objectContaining({ methodology_id: 'P2-SD' })
      );
    });
  ```
  - [ ] Project A can't see Project B's methodologies
  - [ ] Project B can't see Project A's methodologies
  - [ ] Each has its own registry scope

- [ ] **Task 3: Test project-config.yaml isolation**
  ```typescript
  it('project config files are separate per project', () => {
    const configA = loadConfig('projectA');
    const configB = loadConfig('projectB');

    expect(configA.projectId).toBe('projectA');
    expect(configB.projectId).toBe('projectB');

    // Verify different values
    expect(configA).not.toEqual(configB);
  });
  ```

- [ ] **Task 4: Run test**
  ```bash
  npm run test -- packages/core/src/__tests__/project-isolation.test.ts
  ```
  - [ ] Test PASSES

---

## BLOCKER 9: F-THANE-6 — Performance Metrics Not Measured

**Severity:** HIGH | **Effort:** 1.5 hours | **Owner:** QA engineer

**The Problem:**
PRD lists non-functional criteria (discovery <2s, polling <100ms) but Phase 2 doesn't include performance tests. Phase 1 acceptance criteria are unvalidated.

**Files Affected:**
- `packages/bridge/src/__tests__/performance/` (new test file)

**Fix Checklist:**

- [ ] **Task 1: Create performance test file**
  ```bash
  touch packages/bridge/src/__tests__/performance/discovery-benchmark.test.ts
  ```

- [ ] **Task 2: Benchmark discovery for N projects**
  ```typescript
  describe('Discovery Performance', () => {
    beforeAll(async () => {
      // Create 5, 10, 20 test projects
      for (let i = 0; i < 20; i++) {
        await setupGitRepo(path.join(tempRoot, `project${i}`));
      }
    });

    it('discovers 5 projects in <2s', async () => {
      const start = Date.now();
      const result = await discoveryService.discover(tempRoot);
      const elapsed = Date.now() - start;

      expect(result.projects).toHaveLength(5); // or filter first 5
      expect(elapsed).toBeLessThan(2000);
      console.log(`✓ Discovery (5 projects): ${elapsed}ms`);
    });

    it('discovers 10 projects in <2s', async () => {
      const start = Date.now();
      const result = await discoveryService.discover(tempRoot);
      const elapsed = Date.now() - start;

      expect(result.projects.length).toBeGreaterThanOrEqual(10);
      expect(elapsed).toBeLessThan(2000);
      console.log(`✓ Discovery (10 projects): ${elapsed}ms`);
    });

    it('discovers 20 projects in <2s (or reports bottleneck)', async () => {
      const start = Date.now();
      const result = await discoveryService.discover(tempRoot);
      const elapsed = Date.now() - start;

      expect(result.projects.length).toBeGreaterThanOrEqual(20);

      if (elapsed < 2000) {
        console.log(`✓ Discovery (20 projects): ${elapsed}ms`);
      } else {
        console.warn(`⚠ Discovery (20 projects): ${elapsed}ms (exceeds 2s target)`);
        console.warn(`  Bottleneck: check file I/O, YAML parsing, or git validation`);
      }
    });
  });
  ```
  - [ ] 5 projects: <2s assertion
  - [ ] 10 projects: <2s assertion
  - [ ] 20 projects: <2s or report bottleneck
  - [ ] Log detailed timing

- [ ] **Task 3: Benchmark polling loop overhead**
  ```typescript
  describe('Genesis Polling Performance', () => {
    it('polling loop cycles in <100ms', async () => {
      const pollingLoop = new GenesisPollingLoop({ intervalMs: 5000 });

      let totalTime = 0;
      const eventFetcher = async () => {
        const start = Date.now();
        // Simulate event fetch
        await new Promise(resolve => setTimeout(resolve, 10));
        totalTime += Date.now() - start;
        return [];
      };

      // Run 5 polling cycles
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await pollingLoop['pollOnce'](sessionPool, 'test-session', eventFetcher);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(100);
        console.log(`  Cycle ${i+1}: ${elapsed}ms`);
      }

      console.log(`✓ Polling average: ${totalTime / 5}ms`);
    });
  });
  ```
  - [ ] Each cycle <100ms
  - [ ] Average polling time logged
  - [ ] 5 cycle minimum

- [ ] **Task 4: Run test**
  ```bash
  npm run test -- packages/bridge/src/__tests__/performance/discovery-benchmark.test.ts
  ```
  - [ ] Test PASSES (or reports bottleneck)

---

## BLOCKER 10: F-A-5 — Cursor Format Not Versioned

**Severity:** HIGH | **Effort:** 0.5 hours | **Owner:** Bridge engineer

**The Problem:**
`.method/genesis-cursors.yaml` has no version field. If Phase 3 changes the cursor format (e.g., adding projectId), there's no migration path. Versioning is trivial now, impossible to retrofit later.

**Files Affected:**
- `packages/bridge/src/genesis/polling-loop.ts` (cursor read/write)

**Fix Checklist:**

- [ ] **Task 1: Add version to cursor file structure**
  ```typescript
  interface GenesisCursors {
    version: 1;
    lastPolled: number;
    cursors: CursorState[];
  }

  // Default structure when writing
  const defaultCursors: GenesisCursors = {
    version: 1,
    lastPolled: Date.now(),
    cursors: [],
  };
  ```
  - [ ] version = 1 (hard-coded for Phase 2)
  - [ ] lastPolled = timestamp of last poll
  - [ ] cursors = array of cursor states

- [ ] **Task 2: Update read logic**
  ```typescript
  function loadCursors(filePath: string): GenesisCursors {
    if (!fs.existsSync(filePath)) {
      return { version: 1, lastPolled: Date.now(), cursors: [] };
    }

    const data = yaml.load(fs.readFileSync(filePath, 'utf8'));

    // Handle old format (no version field)
    if (!data.version) {
      console.warn('Old cursor format detected, migrating to v1...');
      return {
        version: 1,
        lastPolled: Date.now(),
        cursors: data || [],
      };
    }

    return data;
  }
  ```
  - [ ] Recognize old format (no version)
  - [ ] Auto-migrate to v1
  - [ ] Return proper structure

- [ ] **Task 3: Update write logic**
  ```typescript
  function saveCursors(cursors: GenesisCursors, filePath: string): void {
    const yaml_ = yaml.dump({
      version: cursors.version,
      lastPolled: cursors.lastPolled,
      cursors: cursors.cursors,
    });

    // Atomic write
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, yaml_);
    fs.renameSync(tmpPath, filePath);
  }
  ```
  - [ ] Write version field
  - [ ] Atomic temp + rename pattern
  - [ ] Preserve format integrity

- [ ] **Task 4: Add schema documentation comment**
  ```yaml
  # Genesis Cursor State — v1.0
  # This file tracks the cursor position for Genesis polling across projects.
  # Schema versioning allows forward-compatible evolution in future phases.
  #
  # Format history:
  # v1.0 (Phase 2): Single "root" project cursor (string)
  # v2.0+ (Phase 3): Multi-project cursors with projectId in object
  #
  version: 1
  lastPolled: 1711000000000
  cursors:
    - projectId: root
      cursor: "cursor-1710999900000"
      lastUpdate: 1711000000000
      eventCount: 42
  ```
  - [ ] Document version field
  - [ ] Explain schema history
  - [ ] Comment includes migration notes

- [ ] **Task 5: Test versioning**
  ```bash
  npm run test -- packages/bridge/src/__tests__/cursor-versioning.test.ts
  ```
  - [ ] Write v1 cursor, read it back, verify version preserved
  - [ ] Load old format (no version), verify auto-migrated
  - [ ] Comment in file explains schema (verification)

---

## BLOCKER 11: F-A-9 — Genesis Abort Returns Fake Success

**Severity:** MEDIUM-HIGH | **Effort:** 1.5 hours | **Owner:** Bridge engineer

**The Problem:**
`DELETE /genesis/prompt` endpoint returns 200 `{ aborted: true }` but doesn't actually abort the Genesis session. Client thinks prompt is cancelled, immediately sends new one. Both prompts run in parallel, causing Genesis state inconsistency.

**Files Affected:**
- `packages/bridge/src/genesis-routes.ts` (line 114)
- `packages/bridge/src/session-pool.ts` (SessionPool class)

**Fix Checklist:**

Choose one approach:

### **APPROACH A: Implement Real Abort (Harder, 1.5 hours)**

- [ ] **Task 1: Add cancel() method to SessionPool**
  ```typescript
  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Send SIGINT to PTY process
    session.pty.stdin.write('\x03'); // Ctrl+C

    return true;
  }
  ```
  - [ ] Send SIGINT signal (Ctrl+C) to PTY
  - [ ] Wait for prompt to terminate (timeout 5s)
  - [ ] Return success/failure

- [ ] **Task 2: Update DELETE /genesis/prompt**
  ```typescript
  app.delete('/genesis/prompt', async (request, reply) => {
    const { sessionId } = request.body;

    const cancelled = sessionPool.cancel(sessionId);

    if (!cancelled) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return reply.status(200).send({ aborted: true });
  });
  ```
  - [ ] Call sessionPool.cancel()
  - [ ] Return 404 if session not found
  - [ ] Return 200 only if cancel successful

- [ ] **Task 3: Test abort behavior**
  ```bash
  npm run test -- packages/bridge/__tests__/genesis-abort.test.ts
  ```
  - [ ] Send prompt to Genesis
  - [ ] Wait 500ms, send DELETE /genesis/prompt
  - [ ] Verify prompt terminates
  - [ ] Verify new prompt can be sent without race

### **APPROACH B: Return 501 Not Implemented (Simpler, 0.5 hours) — RECOMMENDED FOR PHASE 2**

- [ ] **Task 1: Update DELETE /genesis/prompt**
  ```typescript
  app.delete('/genesis/prompt', async (request, reply) => {
    // For Phase 2, abort not implemented
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Genesis abort mechanism will be available in Phase 3',
    });
  });
  ```
  - [ ] Return 501 Not Implemented
  - [ ] Explain in error message (Phase 3)

- [ ] **Task 2: Document limitation**
  - [ ] Add to PRD 020 release notes: "Genesis abort not available in Phase 2"
  - [ ] Add to phase-3-backlog: "Implement Genesis abort with SIGINT"

- [ ] **Task 3: Test that endpoint exists but returns 501**
  ```bash
  npm run test -- packages/bridge/__tests__/genesis-abort.test.ts
  ```
  - [ ] DELETE /genesis/prompt → 501
  - [ ] Error message clear
  - [ ] Documented limitation

**RECOMMENDATION:** Use Approach B (501) for Phase 2. Safer than fake success. Easier to implement (0.5h). Schedule real abort for Phase 3.

---

---

## FINAL CHECKLIST

All 11 blockers must show **[✓] COMPLETED** before merge:

- [ ] **F-A-1**: Genesis tools registered in MCP (2h) — OWNER: Bridge
- [ ] **F-A-3**: Polling loop instantiated and started (3h) — OWNER: Bridge
- [ ] **F-P-1**: Event log ring buffer (2h) — OWNER: Bridge
- [ ] **F-P-2**: Cursor map cleanup + LRU (1h) — OWNER: Bridge
- [ ] **F-NIKA-1**: Genesis privilege enforcement (1h) — OWNER: Bridge
- [ ] **F-THANE-2**: project-config.yaml initialization (1.5h) — OWNER: Bridge
- [ ] **F-THANE-4**: E2E portfolio discovery test (2h) — OWNER: QA
- [ ] **F-NIKA-6**: Cross-project isolation test (1h) — OWNER: QA
- [ ] **F-THANE-6**: Performance metrics benchmark (1.5h) — OWNER: QA
- [ ] **F-A-5**: Cursor format versioning (0.5h) — OWNER: Bridge
- [ ] **F-A-9**: Genesis abort (0.5h–1.5h depending on approach) — OWNER: Bridge

**Total Effort:** 16–18 hours (2 bridge engineers + 1 QA engineer, 5–7 days)

**Quality Gates:**
- [ ] All new tests pass: `npm run test`
- [ ] No regressions: `npm run test -- packages/bridge`
- [ ] Integration tests pass: `npm run test -- packages/bridge/src/__tests__/integration`
- [ ] All 11 blockers resolved in corresponding PRs

**Sign-off:**
- [ ] Bridge team lead review
- [ ] QA team lead sign-off
- [ ] Performance benchmark results logged
- [ ] Merge to feat/prd020-phase2 approved

