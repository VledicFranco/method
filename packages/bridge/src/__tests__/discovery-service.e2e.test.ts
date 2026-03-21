/**
 * End-to-End Discovery Test
 * Tests discovery of multiple git repositories with .method/project-config.yaml initialization
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { DiscoveryService } from '../multi-project/discovery-service.js';

// Helper to create a real git repository
function createRealGitRepo(basePath: string, projectName: string): string {
  const projectPath = join(basePath, projectName);
  mkdirSync(projectPath, { recursive: true });

  // Initialize git repo
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });

  // Create a minimal commit so git is valid
  writeFileSync(join(projectPath, 'README.md'), '# Project\n');
  execSync('git add README.md', { cwd: projectPath, stdio: 'pipe' });
  execSync('git -c user.email="test@test.com" -c user.name="Test" commit -m "Initial commit"', {
    cwd: projectPath,
    stdio: 'pipe',
  });

  return projectPath;
}

test('E2E: Discovery discovers 3 real git repositories with metadata', async (t) => {
  const tempDir = join(tmpdir(), `test-e2e-discovery-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create 3 real git repositories
    const project1 = createRealGitRepo(tempDir, 'project-alpha');
    const project2 = createRealGitRepo(tempDir, 'project-beta');
    const project3 = createRealGitRepo(tempDir, 'project-gamma');

    // Verify repos exist before discovery
    assert(existsSync(join(project1, '.git')));
    assert(existsSync(join(project2, '.git')));
    assert(existsSync(join(project3, '.git')));

    // Run discovery from parent temp directory
    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    // Verify all 3 projects discovered
    assert.strictEqual(result.projects.length, 3, 'Should discover all 3 projects');
    assert.strictEqual(result.discovery_incomplete, false, 'Discovery should be complete');

    // Verify project metadata
    const projectIds = result.projects.map((p) => p.id);
    assert(projectIds.includes('project-alpha'), 'Should find project-alpha');
    assert(projectIds.includes('project-beta'), 'Should find project-beta');
    assert(projectIds.includes('project-gamma'), 'Should find project-gamma');

    // Verify each project has correct metadata
    for (const project of result.projects) {
      assert.strictEqual(typeof project.id, 'string', 'Project should have id');
      assert.strictEqual(typeof project.path, 'string', 'Project should have path');
      assert.strictEqual(project.status, 'healthy', 'Project should be healthy');
      assert.strictEqual(project.git_valid, true, 'Git should be valid');
      assert.strictEqual(project.method_dir_exists, true, 'Method dir should be auto-created');
      assert.strictEqual(typeof project.discovered_at, 'string', 'Should have discovered_at timestamp');

      // Verify .method directory was created
      assert(
        existsSync(join(project.path, '.method')),
        `Should have created .method directory for ${project.id}`,
      );
    }

    // Verify metrics
    assert(result.scanned_count >= 3, 'Should have scanned at least 3 directories');
    assert.strictEqual(result.error_count, 0, 'Should have no errors');
    assert(result.elapsed_ms < 5000, 'Discovery should complete within 5 seconds');
  } finally {
    // Cleanup temp repos
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('E2E: Discovery initializes .method directory structure for each project', async (t) => {
  const tempDir = join(tmpdir(), `test-e2e-method-init-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create 2 projects
    const project1 = createRealGitRepo(tempDir, 'project-1');
    const project2 = createRealGitRepo(tempDir, 'project-2');

    // Verify .method doesn't exist before discovery
    assert(!existsSync(join(project1, '.method')), 'project1 should not have .method yet');
    assert(!existsSync(join(project2, '.method')), 'project2 should not have .method yet');

    // Run discovery
    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 2, 'Should find 2 projects');

    // Verify .method was created for both
    assert(existsSync(join(project1, '.method')), 'project1 should have .method after discovery');
    assert(existsSync(join(project2, '.method')), 'project2 should have .method after discovery');
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('E2E: Discovery handles mixed healthy and corrupted repos', async (t) => {
  const tempDir = join(tmpdir(), `test-e2e-mixed-health-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create 1 healthy repo
    const healthyProject = createRealGitRepo(tempDir, 'healthy-project');

    // Create 1 corrupted repo (missing refs/)
    const corruptedProject = join(tempDir, 'corrupted-project');
    const corruptedGitDir = join(corruptedProject, '.git');
    mkdirSync(join(corruptedGitDir, 'objects'), { recursive: true });
    // Deliberately not creating refs/ to make it corrupted

    // Run discovery
    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 2, 'Should discover both projects');

    // Verify healthy project
    const healthyFound = result.projects.find((p) => p.id === 'healthy-project');
    assert(healthyFound, 'Should find healthy project');
    assert.strictEqual(healthyFound.status, 'healthy');
    assert.strictEqual(healthyFound.git_valid, true);

    // Verify corrupted project
    const corruptedFound = result.projects.find((p) => p.id === 'corrupted-project');
    assert(corruptedFound, 'Should find corrupted project');
    assert.strictEqual(corruptedFound.status, 'git_corrupted');
    assert.strictEqual(corruptedFound.git_valid, false);
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('E2E: Cleanup — temp repos are properly handled', async (t) => {
  const tempDir = join(tmpdir(), `test-e2e-cleanup-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create projects
    createRealGitRepo(tempDir, 'cleanup-test-1');
    createRealGitRepo(tempDir, 'cleanup-test-2');

    const service = new DiscoveryService();
    const result = await service.discover(tempDir);

    assert.strictEqual(result.projects.length, 2);

    // Verify temp directory cleanup will work
    assert(existsSync(tempDir), 'Temp dir should exist before cleanup');
  } finally {
    // Cleanup should succeed without errors
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    assert(!existsSync(tempDir), 'Temp dir should be cleaned up');
  }
});
