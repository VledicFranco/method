/**
 * Test suite for Genesis MCP Tools
 * Covers: project_list, project_get, project_read_events, genesis_report, privilege enforcement
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { describe } from 'node:test';
import type { DiscoveryService } from '../projects/discovery-service.js';
import type { ProjectMetadata } from '../projects/discovery-service.js';
import type { ProjectEvent } from '../projects/events/index.js';
import { ProjectEventType, createProjectEvent } from '../projects/events/index.js';
import { NodeFileSystemProvider } from '../../ports/file-system.js';
import {
  projectListTool,
  projectGetTool,
  projectGetManifestTool,
  projectReadEventsTool,
  genesisReportTool,
  type GenesisToolsContext,
} from './tools.js';
// Note: These imports are tested through the MCP bridge integration
// For unit testing, we'll just test the core tool functions directly
type SessionContextForGenesis = { project_id?: string; session_id?: string };

// Simple privilege enforcement for testing
function enforceGenesisPrivilege(ctx: SessionContextForGenesis): void {
  if (ctx.project_id !== 'root') {
    const errorMsg =
      ctx.project_id
        ? `genesis_report is only available to Genesis session (root), not ${ctx.project_id}`
        : 'genesis_report requires Genesis session (project_id="root")';
    const error = new Error(errorMsg);
    (error as any).statusCode = 403;
    throw error;
  }
}

// Simple input validation for testing
async function validateGenesisToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionCtx: SessionContextForGenesis,
): Promise<{
  toolName: string;
  isValid: boolean;
  error?: string;
  validatedInput?: any;
}> {
  try {
    if (toolName === 'genesis_report') {
      enforceGenesisPrivilege(sessionCtx);
      const message = toolInput.message;
      if (!message || typeof message !== 'string' || (message as string).trim().length === 0) {
        throw new Error('message must be a non-empty string');
      }
      return { toolName, isValid: true, validatedInput: { message } };
    }
    if (toolName === 'project_list') {
      return { toolName, isValid: true, validatedInput: {} };
    }
    if (toolName === 'project_get' || toolName === 'project_get_manifest') {
      if (!toolInput.project_id || typeof toolInput.project_id !== 'string') {
        throw new Error('project_id is required');
      }
      return { toolName, isValid: true, validatedInput: toolInput };
    }
    if (toolName === 'project_read_events') {
      return { toolName, isValid: true, validatedInput: toolInput };
    }
    return { toolName, isValid: false, error: `Unknown tool: ${toolName}` };
  } catch (err: any) {
    return {
      toolName,
      isValid: false,
      error: `Invalid input: ${err.message}`,
      ...(err.statusCode && { statusCode: err.statusCode }),
    };
  }
}

// ── Mock Discovery Service ────

const mockDiscoveryService: DiscoveryService = {
  discover: async () => ({
    projects: [
      {
        id: 'project-a',
        name: 'project-a',
        description: '',
        path: '/path/to/project-a',
        status: 'healthy' as const,
        git_valid: true,
        method_dir_exists: true,
        discovered_at: '2026-03-21T12:00:00Z',
        last_scanned: '2026-03-21T12:00:00Z',
      },
      {
        id: 'project-b',
        name: 'project-b',
        description: '',
        path: '/path/to/project-b',
        status: 'git_corrupted' as const,
        git_valid: false,
        method_dir_exists: false,
        error_detail: 'Missing .git/objects',
        discovered_at: '2026-03-21T12:00:00Z',
        last_scanned: '2026-03-21T12:00:00Z',
      },
    ],
    discovery_incomplete: false,
    scanned_count: 5,
    error_count: 1,
    elapsed_ms: 250,
  }),
} as any;

// ── Test Context Setup ────

function createTestContext(): GenesisToolsContext {
  // Create a circular buffer for eventLog
  const eventLog: any = {
    buffer: [
      createProjectEvent(
        ProjectEventType.DISCOVERED,
        'project-a',
        { discovered: true },
        { project_id: 'project-a' },
      ),
      createProjectEvent(
        ProjectEventType.DISCOVERED,
        'project-b',
        { discovered: true },
        { project_id: 'project-b' },
      ),
    ],
    capacity: 10000,
    index: 2,
    count: 2,
  };

  return {
    discoveryService: mockDiscoveryService,
    rootDir: '/test-root',
    fs: new NodeFileSystemProvider(),
    eventLog,
    cursorMap: new Map(),
  };
}

// ── Test Suite ────

describe('Genesis MCP Tools', () => {
  // ── project_list Tests ────

  test('project_list: Returns all discovered projects', async () => {
    const ctx = createTestContext();

    const result = await projectListTool(ctx);

    assert.strictEqual(result.projects.length, 2);
    assert.strictEqual(result.projects[0].id, 'project-a');
    assert.strictEqual(result.projects[1].id, 'project-b');
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.discovery_incomplete, false);
  });

  test('project_list: Marks unhealthy projects with warning', async () => {
    const ctx = createTestContext();

    const result = await projectListTool(ctx);

    // project-a should have checkmark (healthy)
    assert(result.projects[0].description.includes('✓'));
    // project-b should have warning (git_corrupted)
    assert(result.projects[1].description.includes('⚠'));
  });

  // ── project_get Tests ────

  test('project_get: Returns project metadata for valid ID', async () => {
    const ctx = createTestContext();

    const result = await projectGetTool(ctx, 'project-a');

    assert.strictEqual(result.id, 'project-a');
    assert.strictEqual(result.status, 'healthy');
    assert.strictEqual(result.git_valid, true);
    assert.strictEqual(result.method_dir_exists, true);
  });

  test('project_get: Throws error for non-existent project', async () => {
    const ctx = createTestContext();

    await assert.rejects(
      () => projectGetTool(ctx, 'non-existent'),
      /Project not found/,
    );
  });

  test('project_get: Returns error details for corrupted projects', async () => {
    const ctx = createTestContext();

    const result = await projectGetTool(ctx, 'project-b');

    assert.strictEqual(result.status, 'git_corrupted');
    assert.strictEqual(result.git_valid, false);
    assert.strictEqual(result.error_detail, 'Missing .git/objects');
  });

  // ── project_get_manifest Tests ────

  test('project_get_manifest: Throws error for non-existent project', async () => {
    const ctx = createTestContext();

    await assert.rejects(
      () => projectGetManifestTool(ctx, 'non-existent'),
      /Project not found/,
    );
  });

  test('project_get_manifest: Returns manifest path and exists=false if missing', async () => {
    const ctx = createTestContext();

    const result = await projectGetManifestTool(ctx, 'project-a');

    assert.strictEqual(result.project_id, 'project-a');
    // Path will have either forward or backslashes depending on platform
    assert(result.manifest_path.includes('.method') && result.manifest_path.includes('manifest.yaml'));
    // File will not exist in test, so exists should be false
    assert.strictEqual(result.exists, false);
  });

  // ── project_read_events Tests ────

  test('project_read_events: Returns all events without filter', async () => {
    const ctx = createTestContext();

    const result = await projectReadEventsTool(ctx);

    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.hasMore, true);
  });

  test('project_read_events: Filters by project_id', async () => {
    const ctx = createTestContext();

    const result = await projectReadEventsTool(ctx, 'project-a');

    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].metadata?.project_id, 'project-a');
    assert.strictEqual(result.filter?.project_id, 'project-a');
  });

  test('project_read_events: Generates cursor for next read', async () => {
    const ctx = createTestContext();

    const result = await projectReadEventsTool(ctx);

    assert(result.nextCursor);
    assert(typeof result.nextCursor === 'string');
    // Cursor should be stored in cursorMap
    assert(ctx.cursorMap.has(result.nextCursor));
  });

  test('project_read_events: Respects cursor from previous read', async () => {
    const ctx = createTestContext();

    // First read: get all events
    const firstRead = await projectReadEventsTool(ctx);
    assert.strictEqual(firstRead.events.length, 2);

    // Second read with cursor: should get 0 new events
    const secondRead = await projectReadEventsTool(ctx, undefined, firstRead.nextCursor);
    assert.strictEqual(secondRead.events.length, 0);
    assert.strictEqual(secondRead.hasMore, false);
  });

  test('project_read_events: Cleans up old cursors', async () => {
    const ctx = createTestContext();

    // Create multiple cursors with different timestamps (with version field)
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago

    ctx.cursorMap.set('old-cursor', { version: '1', eventIndex: 0, timestamp: oldTimestamp });
    ctx.cursorMap.set('recent-cursor', { version: '1', eventIndex: 0, timestamp: recentTimestamp });

    // Read events (triggers cleanup)
    await projectReadEventsTool(ctx);

    // Old cursor should be removed
    assert.strictEqual(ctx.cursorMap.has('old-cursor'), false);
    // Recent cursor should be kept
    assert.strictEqual(ctx.cursorMap.has('recent-cursor'), true);
  });

  // ── genesis_report Tests ────

  test('genesis_report: Returns delivery confirmation', async () => {
    const result = await genesisReportTool('Test report message');

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.message, 'Test report message');
    assert(result.timestamp);
    assert(typeof result.timestamp === 'string');
  });

  test('genesis_report: Trims whitespace from message', async () => {
    const result = await genesisReportTool('  Report with whitespace  ');

    assert.strictEqual(result.message, 'Report with whitespace');
  });

  test('genesis_report: Throws error for empty message', async () => {
    await assert.rejects(
      () => genesisReportTool(''),
      /cannot be empty/,
    );
  });

  test('genesis_report: Throws error for whitespace-only message', async () => {
    await assert.rejects(
      () => genesisReportTool('   '),
      /cannot be empty/,
    );
  });

  // ── Privilege Enforcement Tests ────

  test('enforceGenesisPrivilege: Allows Genesis session (project_id="root")', () => {
    const ctx: SessionContextForGenesis = { project_id: 'root' };

    // Should not throw
    enforceGenesisPrivilege(ctx);
  });

  test('enforceGenesisPrivilege: Denies non-Genesis session', () => {
    const ctx: SessionContextForGenesis = { project_id: 'project-a' };

    assert.throws(
      () => enforceGenesisPrivilege(ctx),
      /only available to Genesis session/,
    );
  });

  test('enforceGenesisPrivilege: Sets 403 status code on error', () => {
    const ctx: SessionContextForGenesis = { project_id: 'project-a' };

    try {
      enforceGenesisPrivilege(ctx);
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.strictEqual(err.statusCode, 403);
    }
  });

  test('enforceGenesisPrivilege: Denies missing project_id', () => {
    const ctx: SessionContextForGenesis = {};

    assert.throws(
      () => enforceGenesisPrivilege(ctx),
      /requires Genesis session/,
    );
  });

  // ── Input Validation Tests ────

  test('validateGenesisToolInput: Accepts project_list with no args', async () => {
    const result = await validateGenesisToolInput(
      'project_list',
      {},
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, true);
  });

  test('validateGenesisToolInput: Accepts project_get with valid project_id', async () => {
    const result = await validateGenesisToolInput(
      'project_get',
      { project_id: 'project-a' },
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validatedInput.project_id, 'project-a');
  });

  test('validateGenesisToolInput: Rejects project_get without project_id', async () => {
    const result = await validateGenesisToolInput(
      'project_get',
      {},
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, false);
    assert(result.error?.includes('Invalid input'));
  });

  test('validateGenesisToolInput: Accepts project_read_events with optional project_id', async () => {
    const result = await validateGenesisToolInput(
      'project_read_events',
      { project_id: 'project-a', since_cursor: 'cursor123' },
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validatedInput.project_id, 'project-a');
  });

  test('validateGenesisToolInput: Enforces privilege on genesis_report', async () => {
    const result = await validateGenesisToolInput(
      'genesis_report',
      { message: 'Test report' },
      { project_id: 'project-a' },
    );

    assert.strictEqual(result.isValid, false);
    assert(result.error?.includes('Invalid input'));
  });

  test('validateGenesisToolInput: Allows genesis_report for Genesis session', async () => {
    const result = await validateGenesisToolInput(
      'genesis_report',
      { message: 'Test report' },
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validatedInput.message, 'Test report');
  });

  test('validateGenesisToolInput: Rejects genesis_report with empty message', async () => {
    const result = await validateGenesisToolInput(
      'genesis_report',
      { message: '' },
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, false);
  });

  test('validateGenesisToolInput: Rejects unknown tool', async () => {
    const result = await validateGenesisToolInput(
      'unknown_tool',
      {},
      { project_id: 'root' },
    );

    assert.strictEqual(result.isValid, false);
    assert(result.error?.includes('Unknown tool'));
  });
});
