/**
 * PRD 020 Phase 3: Resource Copier Tests
 *
 * Tests for resource_copy_methodology and resource_copy_strategy.
 * Covers: success, failure, partial failure, validation, error handling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { copyMethodology, copyStrategy } from '../resource-copier.js';

// ── Test Helpers ────

/**
 * Create a minimal git repository structure
 */
function createGitRepo(basePath: string, projectName: string): string {
  const projectPath = join(basePath, projectName);
  const gitDir = join(projectPath, '.git');
  const objectsDir = join(gitDir, 'objects');
  const refsDir = join(gitDir, 'refs');

  mkdirSync(projectPath, { recursive: true });
  mkdirSync(objectsDir, { recursive: true });
  mkdirSync(refsDir, { recursive: true });
  writeFileSync(join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n');

  return projectPath;
}

/**
 * Create a manifest.yaml in a project
 */
function createManifest(projectPath: string, manifest: any): void {
  const methodDir = join(projectPath, '.method');
  mkdirSync(methodDir, { recursive: true });
  const manifestPath = join(methodDir, 'manifest.yaml');
  const content = yaml.dump(manifest);
  writeFileSync(manifestPath, content, 'utf-8');
}

/**
 * Read manifest.yaml from a project
 */
function readManifest(projectPath: string): any {
  const manifestPath = join(projectPath, '.method', 'manifest.yaml');
  if (!existsSync(manifestPath)) {
    return null;
  }
  const content = readFileSync(manifestPath, 'utf-8');
  return yaml.load(content) as any;
}

// ── Tests: copyMethodology ────

test('copyMethodology: copies methodology from source to single target', async () => {
  const baseDir = join(tmpdir(), `test-copy-single-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source-proj');
    const targetPath = createGitRepo(baseDir, 'target-proj');

    // Create source manifest with methodology
    const sourceManifest = {
      manifest: {
        project: 'source-proj',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
            card: 'project-card.yaml',
          },
        ],
      },
    };
    createManifest(sourcePath, sourceManifest);

    // Create empty target manifest
    const targetManifest = {
      manifest: {
        project: 'target-proj',
        last_updated: '2026-03-21',
        installed: [],
      },
    };
    createManifest(targetPath, targetManifest);

    // Change to baseDir so relative paths work
    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      // Copy from source to target (using relative paths)
      const result = await copyMethodology({
        source_id: 'source-proj',
        method_name: 'P2-SD',
        target_ids: ['target-proj'],
      });

      assert.strictEqual(result.copied_to.length, 1);
      assert.strictEqual(result.copied_to[0].project_id, 'target-proj');
      assert.strictEqual(result.copied_to[0].status, 'success');

      // Verify target manifest was updated
      const updatedTarget = readManifest(targetPath);
      assert(updatedTarget.manifest.installed.length > 0);
      assert.strictEqual(updatedTarget.manifest.installed[0].id, 'P2-SD');
      assert.strictEqual(updatedTarget.manifest.installed[0].type, 'methodology');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: copies methodology to multiple targets', async () => {
  const baseDir = join(tmpdir(), `test-copy-multi-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const target1Path = createGitRepo(baseDir, 'target1');
    const target2Path = createGitRepo(baseDir, 'target2');

    const sourceManifest = {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P1-EXEC',
            type: 'methodology',
            version: '1.1',
          },
        ],
      },
    };
    createManifest(sourcePath, sourceManifest);

    createManifest(target1Path, {
      manifest: { project: 'target1', last_updated: '2026-03-21', installed: [] },
    });
    createManifest(target2Path, {
      manifest: { project: 'target2', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P1-EXEC',
        target_ids: ['target1', 'target2'],
      });

      assert.strictEqual(result.copied_to.length, 2);
      assert.strictEqual(result.copied_to[0].status, 'success');
      assert.strictEqual(result.copied_to[1].status, 'success');

      // Verify both targets have the methodology
      const updated1 = readManifest(target1Path);
      const updated2 = readManifest(target2Path);
      assert.strictEqual(updated1.manifest.installed[0].id, 'P1-EXEC');
      assert.strictEqual(updated2.manifest.installed[0].id, 'P1-EXEC');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: replaces existing methodology in target', async () => {
  const baseDir = join(tmpdir(), `test-copy-replace-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    const sourceManifest = {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
            description: 'New version',
          },
        ],
      },
    };
    createManifest(sourcePath, sourceManifest);

    const targetManifest = {
      manifest: {
        project: 'target',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '1.9',
            description: 'Old version',
          },
        ],
      },
    };
    createManifest(targetPath, targetManifest);

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'success');

      const updated = readManifest(targetPath);
      assert.strictEqual(updated.manifest.installed.length, 1);
      assert.strictEqual(updated.manifest.installed[0].version, '2.0');
      assert.strictEqual(updated.manifest.installed[0].description, 'New version');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: handles source not found', async () => {
  const baseDir = join(tmpdir(), `test-copy-no-source-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const targetPath = createGitRepo(baseDir, 'target');
    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'nonexistent',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to.length, 1);
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('not found'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: handles methodology not found in source', async () => {
  const baseDir = join(tmpdir(), `test-copy-no-method-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P1-EXEC',
            type: 'methodology',
            version: '1.1',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'NONEXISTENT',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('not found'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: handles target not found gracefully', async () => {
  const baseDir = join(tmpdir(), `test-copy-no-target-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['nonexistent'],
      });

      assert.strictEqual(result.copied_to.length, 1);
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('not found'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: handles partial failures (one succeeds, one fails)', async () => {
  const baseDir = join(tmpdir(), `test-copy-partial-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const validTarget = createGitRepo(baseDir, 'valid-target');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    createManifest(validTarget, {
      manifest: { project: 'valid-target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['valid-target', 'nonexistent-target'],
      });

      assert.strictEqual(result.copied_to.length, 2);
      const validResult = result.copied_to.find((r) => r.project_id === 'valid-target');
      const invalidResult = result.copied_to.find((r) => r.project_id === 'nonexistent-target');

      assert.strictEqual(validResult?.status, 'success');
      assert.strictEqual(invalidResult?.status, 'error');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyMethodology: creates .method directory if missing', async () => {
  const baseDir = join(tmpdir(), `test-copy-create-method-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    // Don't create .method in target

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'success');
      assert(existsSync(join(targetPath, '.method', 'manifest.yaml')));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

// ── Tests: copyStrategy ────

test('copyStrategy: copies strategy from source to target', async () => {
  const baseDir = join(tmpdir(), `test-copy-strategy-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    const sourceManifest = {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'STRAT-001',
            type: 'strategy',
            version: '1.0',
            description: 'Test strategy',
          },
        ],
      },
    };
    createManifest(sourcePath, sourceManifest);

    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyStrategy({
        source_id: 'source',
        strategy_name: 'STRAT-001',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'success');

      const updated = readManifest(targetPath);
      assert.strictEqual(updated.manifest.installed[0].id, 'STRAT-001');
      assert.strictEqual(updated.manifest.installed[0].type, 'strategy');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyStrategy: handles strategy not found', async () => {
  const baseDir = join(tmpdir(), `test-copy-strategy-notfound-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'OTHER-STRAT',
            type: 'strategy',
            version: '1.0',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyStrategy({
        source_id: 'source',
        strategy_name: 'NONEXISTENT-STRAT',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('not found'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('copyStrategy: copies strategy to multiple targets', async () => {
  const baseDir = join(tmpdir(), `test-copy-strategy-multi-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const target1 = createGitRepo(baseDir, 'target1');
    const target2 = createGitRepo(baseDir, 'target2');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'STRAT-ABC',
            type: 'strategy',
            version: '1.0',
          },
        ],
      },
    });

    createManifest(target1, {
      manifest: { project: 'target1', last_updated: '2026-03-21', installed: [] },
    });
    createManifest(target2, {
      manifest: { project: 'target2', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyStrategy({
        source_id: 'source',
        strategy_name: 'STRAT-ABC',
        target_ids: ['target1', 'target2'],
      });

      assert.strictEqual(result.copied_to.length, 2);
      assert.strictEqual(result.copied_to[0].status, 'success');
      assert.strictEqual(result.copied_to[1].status, 'success');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

// ── Tests: Validation & Error Handling ────

test('Resource Copier: updates last_updated timestamp on copy', async () => {
  const baseDir = join(tmpdir(), `test-timestamp-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    const oldDate = '2020-01-01';
    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: oldDate,
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: oldDate, installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      assert.strictEqual(result.copied_to[0].status, 'success');

      const updated = readManifest(targetPath);
      const today = new Date().toISOString().split('T')[0];
      assert.strictEqual(updated.manifest.last_updated, today);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('Resource Copier: handles malformed source manifest gracefully', async () => {
  const baseDir = join(tmpdir(), `test-malformed-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target');

    // Create invalid manifest
    const methodDir = join(sourcePath, '.method');
    mkdirSync(methodDir, { recursive: true });
    writeFileSync(join(methodDir, 'manifest.yaml'), 'invalid: [yaml: [', 'utf-8');

    createManifest(targetPath, {
      manifest: { project: 'target', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      // Should handle gracefully
      assert.strictEqual(result.copied_to[0].status, 'error');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

// ── Tests: Path Traversal Protection ────

test('Resource Copier: blocks path traversal with ../', async () => {
  const baseDir = join(tmpdir(), `test-traversal-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: '../../etc/passwd',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      // Should report error due to path traversal
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('Path traversal'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('Resource Copier: blocks path traversal in target with ../', async () => {
  const baseDir = join(tmpdir(), `test-traversal-target-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['../sibling'],
      });

      // Should report error due to path traversal
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('Path traversal'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('Resource Copier: blocks absolute paths', async () => {
  const baseDir = join(tmpdir(), `test-absolute-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: '/etc/passwd',
        method_name: 'P2-SD',
        target_ids: ['target'],
      });

      // Should report error due to path traversal
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('Path traversal'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('Resource Copier: allows valid project names', async () => {
  const baseDir = join(tmpdir(), `test-valid-names-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');
    const targetPath = createGitRepo(baseDir, 'target-project');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'P2-SD',
            type: 'methodology',
            version: '2.0',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: { project: 'target-project', last_updated: '2026-03-21', installed: [] },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyMethodology({
        source_id: 'source',
        method_name: 'P2-SD',
        target_ids: ['target-project'],
      });

      // Should succeed with valid names
      assert.strictEqual(result.copied_to[0].status, 'success');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('Resource Copier: blocks path traversal in strategy copy', async () => {
  const baseDir = join(tmpdir(), `test-strat-traversal-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source');

    createManifest(sourcePath, {
      manifest: {
        project: 'source',
        last_updated: '2026-03-21',
        installed: [
          {
            id: 'STRAT-001',
            type: 'strategy',
            version: '1.0',
          },
        ],
      },
    });

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      const result = await copyStrategy({
        source_id: '../../evil',
        strategy_name: 'STRAT-001',
        target_ids: ['target'],
      });

      // Should report error due to path traversal
      assert.strictEqual(result.copied_to[0].status, 'error');
      assert(result.copied_to[0].error_detail?.includes('Path traversal'));
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});
