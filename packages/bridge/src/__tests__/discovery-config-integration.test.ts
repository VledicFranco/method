/**
 * Test suite for F-THANE-2: Project Config Discovery Integration
 *
 * Covers:
 * - Discover projects with manifests and verify configs loaded
 * - Discover project without manifest, handles gracefully
 * - Rescan reloads all configs
 * - Integration: Create project, discover, verify manifest appears
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DiscoveryService } from '../multi-project/discovery-service.js';
import { discoverAndRegister, loadProjectConfig, rescanAndReloadConfigs } from '../multi-project/discovery-registry-integration.js';
import { InMemoryProjectRegistry } from '../registry/index.js';

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

// Helper to create a project config
function createProjectConfig(projectPath: string, configData: any): void {
  const methodDir = join(projectPath, '.method');
  mkdirSync(methodDir, { recursive: true });

  const configYaml = `id: ${configData.id}
name: ${configData.name}
description: ${configData.description || 'Test project'}
owner: ${configData.owner || 'test-owner'}
version: ${configData.version || '1.0.0'}
`;

  writeFileSync(join(methodDir, 'project-config.yaml'), configYaml);
}

test('F-THANE-2: Discover projects with manifests and verify configs loaded', async () => {
  const tempDir = join(tmpdir(), `test-f-thane2-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create two test projects with configs
    const project1 = createMockGitRepo(tempDir, 'project-alpha');
    createProjectConfig(project1, {
      id: 'project-alpha',
      name: 'Project Alpha',
      description: 'First test project',
      owner: 'alice',
      version: '1.0.0',
    });

    const project2 = createMockGitRepo(tempDir, 'project-beta');
    createProjectConfig(project2, {
      id: 'project-beta',
      name: 'Project Beta',
      description: 'Second test project',
      owner: 'bob',
      version: '2.0.0',
    });

    // Discover and register
    const discovery = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const result = await discoverAndRegister(discovery, registry, tempDir);

    // Verify discovery found both projects
    assert.strictEqual(result.projects.length, 2, 'Should discover 2 projects');
    assert.strictEqual(result.discovery_incomplete, false);

    // Verify configs were loaded
    assert.strictEqual(result.configs_loaded, 2, 'Should load 2 configs');
    assert.strictEqual(result.configs_failed, 0, 'Should have 0 failed configs');

    // Verify configs are in registry
    const configAlpha = registry.getProjectConfig('project-alpha');
    assert.ok(configAlpha, 'Should have project-alpha config in registry');
    assert.strictEqual(configAlpha.name, 'Project Alpha');
    assert.strictEqual(configAlpha.owner, 'alice');

    const configBeta = registry.getProjectConfig('project-beta');
    assert.ok(configBeta, 'Should have project-beta config in registry');
    assert.strictEqual(configBeta.name, 'Project Beta');
    assert.strictEqual(configBeta.owner, 'bob');

    // Verify list configs
    const allConfigs = registry.listProjectConfigs();
    assert.strictEqual(allConfigs.length, 2, 'Should list 2 configs');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: Discover project without manifest, handles gracefully', async () => {
  const tempDir = join(tmpdir(), `test-f-thane2-no-manifest-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create one project with config, one without
    const project1 = createMockGitRepo(tempDir, 'with-config');
    createProjectConfig(project1, {
      id: 'with-config',
      name: 'With Config',
    });

    const project2 = createMockGitRepo(tempDir, 'without-config');
    // Don't create a config for project2

    const discovery = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const result = await discoverAndRegister(discovery, registry, tempDir);

    // Verify discovery found both projects
    assert.strictEqual(result.projects.length, 2, 'Should discover 2 projects');

    // Verify one config loaded, one failed
    assert.strictEqual(result.configs_loaded, 1, 'Should load 1 config');
    assert.strictEqual(result.configs_failed, 1, 'Should have 1 failed config');

    // Verify only the first is in registry
    const config1 = registry.getProjectConfig('with-config');
    assert.ok(config1, 'Should have with-config in registry');

    const config2 = registry.getProjectConfig('without-config');
    assert.strictEqual(config2, undefined, 'Should not have without-config in registry');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: Rescan reloads all configs', async () => {
  const tempDir = join(tmpdir(), `test-f-thane2-rescan-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Create initial project with config
    const project = createMockGitRepo(tempDir, 'rescan-test');
    createProjectConfig(project, {
      id: 'rescan-test',
      name: 'Original Name',
      owner: 'alice',
    });

    const discovery = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    // First discovery
    let result = await discoverAndRegister(discovery, registry, tempDir);
    assert.strictEqual(result.configs_loaded, 1);

    let config = registry.getProjectConfig('rescan-test');
    assert.strictEqual(config?.name, 'Original Name');

    // Update the config
    createProjectConfig(project, {
      id: 'rescan-test',
      name: 'Updated Name',
      owner: 'bob',
    });

    // Rescan and reload
    result = await rescanAndReloadConfigs(discovery, registry, tempDir);
    assert.strictEqual(result.configs_loaded, 1);

    // Verify config was updated
    config = registry.getProjectConfig('rescan-test');
    assert.strictEqual(config?.name, 'Updated Name');
    assert.strictEqual(config?.owner, 'bob');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: loadProjectConfig with valid config', async () => {
  const tempDir = join(tmpdir(), `test-load-config-valid-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = join(tempDir, 'test-project');
    createMockGitRepo(tempDir, 'test-project');
    createProjectConfig(projectPath, {
      id: 'test-project',
      name: 'Test Project',
      owner: 'tester',
    });

    const config = loadProjectConfig(projectPath, 'test-project');

    assert.ok(config, 'Should load config');
    assert.strictEqual(config!.id, 'test-project');
    assert.strictEqual(config!.name, 'Test Project');
    assert.strictEqual(config!.owner, 'tester');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: loadProjectConfig with missing file returns null', async () => {
  const tempDir = join(tmpdir(), `test-load-config-missing-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = join(tempDir, 'test-project');
    mkdirSync(join(projectPath, '.method'), { recursive: true });

    const config = loadProjectConfig(projectPath, 'test-project');

    assert.strictEqual(config, null, 'Should return null for missing config');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: loadProjectConfig with invalid YAML returns null', async () => {
  const tempDir = join(tmpdir(), `test-load-config-invalid-yaml-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = join(tempDir, 'test-project');
    const methodDir = join(projectPath, '.method');
    mkdirSync(methodDir, { recursive: true });

    // Write invalid YAML
    writeFileSync(join(methodDir, 'project-config.yaml'), 'invalid: yaml: content:\n  - unclosed');

    const config = loadProjectConfig(projectPath, 'test-project');

    assert.strictEqual(config, null, 'Should return null for invalid YAML');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: loadProjectConfig with missing required fields returns null', async () => {
  const tempDir = join(tmpdir(), `test-load-config-missing-fields-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const projectPath = join(tempDir, 'test-project');
    const methodDir = join(projectPath, '.method');
    mkdirSync(methodDir, { recursive: true });

    // Config missing 'name' field
    writeFileSync(join(methodDir, 'project-config.yaml'), 'id: test-project\n');

    const config = loadProjectConfig(projectPath, 'test-project');

    assert.strictEqual(config, null, 'Should return null for missing required fields');
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('F-THANE-2: ProjectRegistry.registerProjectConfig and retrieval', async () => {
  const registry = new InMemoryProjectRegistry();

  const config = {
    id: 'test-proj',
    name: 'Test Project',
    owner: 'alice',
    version: '1.2.3',
  };

  registry.registerProjectConfig(config);

  const retrieved = registry.getProjectConfig('test-proj');
  assert.ok(retrieved, 'Should retrieve registered config');
  assert.strictEqual(retrieved.id, 'test-proj');
  assert.strictEqual(retrieved.name, 'Test Project');
});

test('F-THANE-2: ProjectRegistry.listProjectConfigs', async () => {
  const registry = new InMemoryProjectRegistry();

  const config1 = { id: 'proj-1', name: 'Project 1' };
  const config2 = { id: 'proj-2', name: 'Project 2' };

  registry.registerProjectConfig(config1);
  registry.registerProjectConfig(config2);

  const all = registry.listProjectConfigs();
  assert.strictEqual(all.length, 2, 'Should list 2 configs');
  assert(all.some((c) => c.id === 'proj-1'), 'Should contain proj-1');
  assert(all.some((c) => c.id === 'proj-2'), 'Should contain proj-2');
});
