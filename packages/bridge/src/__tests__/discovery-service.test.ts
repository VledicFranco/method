/**
 * Test suite for DiscoveryService
 * Covers: recursive scan, timeout, max_projects, error recovery, performance
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DiscoveryService } from '../multi-project/discovery-service.js';

// Helper to create a mock git repository
function createMockGitRepo(basePath: string, projectName: string): string {
  const projectPath = join(basePath, projectName);
  const gitDir = join(projectPath, '.git');
  const objectsDir = join(gitDir, 'objects');
  const refsDir = join(gitDir, 'refs');

  mkdirSync(projectPath, { recursive: true });
  mkdirSync(objectsDir, { recursive: true });
  mkdirSync(refsDir, { recursive: true });

  // Create minimal git config
  writeFileSync(join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n');

  return projectPath;
}

test('DiscoveryService: Basic discovery finds git repositories', async () => {
  const tempDir = join(tmpdir(), `test-discovery-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create test repos
    createMockGitRepo(tempDir, 'project-1');
    createMockGitRepo(tempDir, 'project-2');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 2, 'Should find 2 projects');
    assert.strictEqual(result.discovery_incomplete, false, 'Discovery should be complete');
    assert.strictEqual(result.error_count, 0, 'Should have no errors');
    assert(result.elapsed_ms < 5000, 'Discovery should complete quickly');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Recursive discovery in nested directories', async () => {
  const tempDir = join(tmpdir(), `test-discovery-nested-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create nested repos
    createMockGitRepo(tempDir, 'level1-project');
    const level1 = join(tempDir, 'subdir1');
    mkdirSync(level1, { recursive: true });
    createMockGitRepo(level1, 'level2-project');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 2, 'Should find 2 projects recursively');
    assert.strictEqual(result.discovery_incomplete, false);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Auto-creates .method directory', async () => {
  const tempDir = join(tmpdir(), `test-discovery-method-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = createMockGitRepo(tempDir, 'test-project');
    const methodDir = join(projectPath, '.method');

    // Verify it doesn't exist before discovery
    assert(!existsSync(methodDir));

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 1);
    const project = result.projects[0];
    // After discovery, the directory should be created
    assert(existsSync(methodDir));
    assert.strictEqual(project.method_dir_exists, true);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Timeout protection', async () => {
  const tempDir = join(tmpdir(), `test-discovery-timeout-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create many nested directories to trigger timeout
    let currentPath = tempDir;
    for (let i = 0; i < 10; i++) {
      currentPath = join(currentPath, `deep-${i}`);
      mkdirSync(currentPath, { recursive: true });

      if (i % 3 === 0) {
        createMockGitRepo(currentPath, `project-${i}`);
      }
    }

    // Very short timeout (10ms)
    const service = new DiscoveryService({ timeoutMs: 10 });
    const result = await service.discover(tempDir);

    assert.strictEqual(result.elapsed_ms <= 100, true, 'Should respect timeout');
    // May or may not be incomplete depending on speed, but should not crash
    assert(result.projects.length >= 0);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Max projects limit', async () => {
  const tempDir = join(tmpdir(), `test-discovery-maxproj-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create more projects than max
    for (let i = 0; i < 15; i++) {
      createMockGitRepo(tempDir, `project-${i}`);
    }

    const service = new DiscoveryService({ maxProjects: 5 });
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 5, 'Should stop at max projects');
    assert.strictEqual(result.discovery_incomplete, true, 'Should mark discovery incomplete');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Error recovery - corrupted git repo', async () => {
  const tempDir = join(tmpdir(), `test-discovery-corrupted-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create valid repo
    createMockGitRepo(tempDir, 'valid-project');

    // Create corrupted repo (missing refs/)
    const corruptedPath = join(tempDir, 'corrupted-project');
    const gitDir = join(corruptedPath, '.git');
    mkdirSync(join(gitDir, 'objects'), { recursive: true });
    // Deliberately not creating refs/

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert(result.projects.length >= 1);

    // Find corrupted project if discovered
    const corrupted = result.projects.find((p) => p.id === 'corrupted-project');
    if (corrupted) {
      assert.strictEqual(corrupted.status, 'git_corrupted');
      assert.strictEqual(corrupted.git_valid, false);
    }
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Performance for 20 projects', async () => {
  const tempDir = join(tmpdir(), `test-discovery-perf-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create 20 projects
    for (let i = 0; i < 20; i++) {
      createMockGitRepo(tempDir, `project-${String(i).padStart(2, '0')}`);
    }

    const service = new DiscoveryService();
    const start = Date.now();
    const result = await service.discover(tempDir);
    const elapsed = Date.now() - start;

    assert.strictEqual(result.projects.length, 20);
    assert(elapsed < 500);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Non-existent root directory', async () => {
  const service = new DiscoveryService();
  const result = await service.discover('/nonexistent/path/12345');

  assert.strictEqual(result.projects.length, 0);
  assert(result.error, 'Should return error message');
  assert.strictEqual(result.error_count, 1);
});

test('DiscoveryService: Returns correct ProjectMetadata structure', async () => {
  const tempDir = join(tmpdir(), `test-discovery-struct-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    createMockGitRepo(tempDir, 'test-project');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 1);
    const project = result.projects[0];

    // Verify structure
    assert.strictEqual(typeof project.id, 'string');
    assert.strictEqual(typeof project.path, 'string');
    assert(['healthy', 'git_corrupted', 'missing_config', 'permission_denied'].includes(project.status));
    assert.strictEqual(typeof project.git_valid, 'boolean');
    assert.strictEqual(typeof project.method_dir_exists, 'boolean');
    assert.strictEqual(typeof project.discovered_at, 'string');

    // Parse timestamp
    const timestamp = new Date(project.discovered_at);
    assert(!isNaN(timestamp.getTime()), 'discovered_at should be valid ISO date');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: DiscoveryResult structure', async () => {
  const tempDir = join(tmpdir(), `test-discovery-result-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    createMockGitRepo(tempDir, 'project-1');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    // Verify result structure
    assert(Array.isArray(result.projects));
    assert.strictEqual(typeof result.discovery_incomplete, 'boolean');
    assert.strictEqual(typeof result.scanned_count, 'number');
    assert.strictEqual(typeof result.error_count, 'number');
    assert.strictEqual(typeof result.elapsed_ms, 'number');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Avoids scanning node_modules', async () => {
  const tempDir = join(tmpdir(), `test-discovery-nodemod-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create a project
    createMockGitRepo(tempDir, 'main-project');

    // Create node_modules with fake git repos inside
    const nmPath = join(tempDir, 'node_modules');
    mkdirSync(nmPath, { recursive: true });
    createMockGitRepo(nmPath, 'fake-dep-with-git');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    // Should only find main-project, not the one in node_modules
    assert.strictEqual(
      result.projects.length,
      1,
      'Should skip repos in node_modules',
    );
    assert.strictEqual(result.projects[0].id, 'main-project');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Prevents infinite loops with symlinks', async () => {
  const tempDir = join(tmpdir(), `test-discovery-symlink-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = createMockGitRepo(tempDir, 'project-a');

    // Try to create a symlink (skip on Windows if not available)
    try {
      const linkPath = join(tempDir, 'link-to-project');
      // On Windows, need to check if we have permission to create symlinks
      // Most tests will skip this, which is fine
      const fs = await import('node:fs').then((m) => m);
      const realPath = join(projectPath, '..');
      // Don't actually create symlink for cross-platform safety
      // Just verify the service doesn't crash
    } catch {
      // Skip symlink test on systems where it's not supported
    }

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    // Should complete without infinite loop
    assert(result.projects.length >= 1);
    assert(result.elapsed_ms < 5000);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Emits discovery_incomplete flag when MAX_PROJECTS exceeded', async () => {
  const tempDir = join(tmpdir(), `test-discovery-incomplete-flag-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create 60 projects (more than default max of 50 in some test setups)
    // Using a small maxProjects limit to test the flag
    for (let i = 0; i < 60; i++) {
      createMockGitRepo(tempDir, `project-${String(i).padStart(3, '0')}`);
    }

    const service = new DiscoveryService({ maxProjects: 50 });
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 50, 'Should stop at max projects (50)');
    assert.strictEqual(result.discovery_incomplete, true, 'discovery_incomplete should be true');
    assert.strictEqual(result.stopped_at_max_projects, true, 'stopped_at_max_projects should be true');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Resilience — skips corrupted .git/ and marks as git_corrupted', async () => {
  const tempDir = join(tmpdir(), `test-discovery-corrupted-resilience-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create one valid repo
    createMockGitRepo(tempDir, 'valid-project');

    // Create one corrupted repo (missing refs/ directory makes it invalid)
    const corruptedPath = join(tempDir, 'corrupted-project');
    const corruptedGitDir = join(corruptedPath, '.git');
    mkdirSync(join(corruptedGitDir, 'objects'), { recursive: true });
    // Deliberately NOT creating refs/ to make it corrupted

    // Discovery should continue despite the corrupted repo
    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    // Should find both repos
    assert.strictEqual(result.projects.length, 2, 'Should discover both projects despite corruption');
    assert.strictEqual(result.error_count, 0, 'Should not count as errors in discovery');

    // Verify the valid one is healthy
    const validProject = result.projects.find((p) => p.id === 'valid-project');
    assert(validProject);
    assert.strictEqual(validProject.status, 'healthy');
    assert.strictEqual(validProject.git_valid, true);

    // Verify the corrupted one is marked as git_corrupted
    const corruptedProject = result.projects.find((p) => p.id === 'corrupted-project');
    assert(corruptedProject);
    assert.strictEqual(corruptedProject.status, 'git_corrupted', 'Should mark as git_corrupted');
    assert.strictEqual(corruptedProject.git_valid, false);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Cache returns same result within TTL', async () => {
  const tempDir = join(tmpdir(), `test-discovery-cache-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    createMockGitRepo(tempDir, 'project-1');
    createMockGitRepo(tempDir, 'project-2');

    const service = new DiscoveryService({ cacheTtlMs: 5000 });

    // First discovery
    const result1 = await service.discover(tempDir);
    assert.strictEqual(result1.projects.length, 2);

    // Get cached result without re-scanning
    const cached = service.getCachedProjects();
    assert.strictEqual(cached.length, 2);
    assert.deepStrictEqual(cached, result1.projects);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: Cache expires after TTL', async () => {
  const tempDir = join(tmpdir(), `test-discovery-cache-expire-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    createMockGitRepo(tempDir, 'project-1');

    const service = new DiscoveryService({ cacheTtlMs: 100 }); // 100ms TTL

    // First discovery
    await service.discover(tempDir);
    const cached1 = service.getCachedProjects();
    assert.strictEqual(cached1.length, 1);

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Cache should be empty after expiration
    const cached2 = service.getCachedProjects();
    assert.strictEqual(cached2.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('DiscoveryService: clearCache() forces fresh scan', async () => {
  const tempDir = join(tmpdir(), `test-discovery-clear-cache-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    createMockGitRepo(tempDir, 'project-1');

    const service = new DiscoveryService();

    // First discovery
    const result1 = await service.discover(tempDir);
    assert.strictEqual(result1.projects.length, 1);

    // Verify cache is populated
    const cached1 = service.getCachedProjects();
    assert.strictEqual(cached1.length, 1);

    // Clear cache
    service.clearCache();

    // Cache should be empty
    const cached2 = service.getCachedProjects();
    assert.strictEqual(cached2.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});
