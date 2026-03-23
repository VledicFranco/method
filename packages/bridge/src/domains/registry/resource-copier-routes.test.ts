/**
 * PRD 020 Phase 3: Resource Copier Routes Tests
 *
 * Tests the HTTP endpoints for resource copying.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerProjectRoutes } from '../../project-routes.js';
import { DiscoveryService } from '../../multi-project/discovery-service.js';
import { InMemoryProjectRegistry } from './index.js';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

/**
 * Helper: Create a minimal git repository
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
 * Helper: Create a manifest.yaml in a project
 */
function createManifest(projectPath: string, manifest: any): void {
  const methodDir = join(projectPath, '.method');
  mkdirSync(methodDir, { recursive: true });
  const manifestPath = join(methodDir, 'manifest.yaml');
  const content = yaml.dump(manifest);
  writeFileSync(manifestPath, content, 'utf-8');
}

test('POST /api/resources/copy-methodology: copies methodology between projects', async () => {
  const baseDir = join(tmpdir(), `test-routes-copy-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source-proj');
    const targetPath = createGitRepo(baseDir, 'target-proj');

    // Create manifests
    createManifest(sourcePath, {
      manifest: {
        project: 'source-proj',
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
      manifest: {
        project: 'target-proj',
        last_updated: '2026-03-21',
        installed: [],
      },
    });

    // Create Fastify app and register routes
    const app = Fastify({ logger: false });
    const discoveryService = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      await registerProjectRoutes(app, discoveryService, registry);
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/resources/copy-methodology',
          payload: {
            source_id: 'source-proj',
            method_name: 'P2-SD',
            target_ids: ['target-proj'],
          },
        });

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body);

        assert(body.copied_to);
        assert.strictEqual(body.copied_to.length, 1);
        assert.strictEqual(body.copied_to[0].status, 'success');
        assert.strictEqual(body.copied_to[0].project_id, 'target-proj');
      } finally {
        await app.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('POST /api/resources/copy-strategy: copies strategy between projects', async () => {
  const baseDir = join(tmpdir(), `test-routes-strat-${Date.now()}`);
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
            id: 'STRAT-001',
            type: 'strategy',
            version: '1.0',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: {
        project: 'target',
        last_updated: '2026-03-21',
        installed: [],
      },
    });

    const app = Fastify({ logger: false });
    const discoveryService = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      await registerProjectRoutes(app, discoveryService, registry);
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/resources/copy-strategy',
          payload: {
            source_id: 'source',
            strategy_name: 'STRAT-001',
            target_ids: ['target'],
          },
        });

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body);

        assert(body.copied_to);
        assert.strictEqual(body.copied_to.length, 1);
        assert.strictEqual(body.copied_to[0].status, 'success');
      } finally {
        await app.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('POST /api/resources/copy-methodology: returns 400 for missing fields', async () => {
  const app = Fastify({ logger: false });
  const discoveryService = new DiscoveryService();
  const registry = new InMemoryProjectRegistry();

  await registerProjectRoutes(app, discoveryService, registry);
  await app.ready();

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/resources/copy-methodology',
      payload: {
        source_id: 'source',
        // Missing method_name and target_ids
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert(body.error);
  } finally {
    await app.close();
  }
});

test('POST /api/resources/copy-methodology: handles partial failures gracefully', async () => {
  const baseDir = join(tmpdir(), `test-routes-partial-${Date.now()}`);
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
      manifest: {
        project: 'valid-target',
        last_updated: '2026-03-21',
        installed: [],
      },
    });

    const app = Fastify({ logger: false });
    const discoveryService = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      await registerProjectRoutes(app, discoveryService, registry);
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/resources/copy-methodology',
          payload: {
            source_id: 'source',
            method_name: 'P2-SD',
            target_ids: ['valid-target', 'nonexistent-target'],
          },
        });

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body);

        assert.strictEqual(body.copied_to.length, 2);
        const validResult = body.copied_to.find((r: any) => r.project_id === 'valid-target');
        const invalidResult = body.copied_to.find((r: any) => r.project_id === 'nonexistent-target');

        assert.strictEqual(validResult.status, 'success');
        assert.strictEqual(invalidResult.status, 'error');
      } finally {
        await app.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

// ── F-SEC-002: Resource Copy Authorization Tests ────

test('POST /api/resources/copy-methodology: Returns 403 when requester cannot access source project', async () => {
  const baseDir = join(tmpdir(), `test-routes-sec-method-${Date.now()}`);
  mkdirSync(baseDir, { recursive: true });

  try {
    const sourcePath = createGitRepo(baseDir, 'source-proj');
    const targetPath = createGitRepo(baseDir, 'target-proj');

    createManifest(sourcePath, {
      manifest: {
        project: 'source-proj',
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
      manifest: {
        project: 'target-proj',
        last_updated: '2026-03-21',
        installed: [],
      },
    });

    const app = Fastify({ logger: false });
    const discoveryService = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      await registerProjectRoutes(app, discoveryService, registry);
      await app.ready();

      try {
        // Request with x-project-id=other-proj trying to copy from source-proj
        const response = await app.inject({
          method: 'POST',
          url: '/api/resources/copy-methodology',
          headers: {
            'x-project-id': 'other-proj',
          },
          payload: {
            source_id: 'source-proj',
            method_name: 'P2-SD',
            target_ids: ['target-proj'],
          },
        });

        assert.strictEqual(response.statusCode, 403);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.error, 'Access denied');
        assert(body.reason.includes('Cannot copy from project source-proj'));
      } finally {
        await app.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});

test('POST /api/resources/copy-strategy: Returns 403 when requester cannot access source project', async () => {
  const baseDir = join(tmpdir(), `test-routes-sec-strat-${Date.now()}`);
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
            id: 'STRAT-001',
            type: 'strategy',
            version: '1.0',
          },
        ],
      },
    });

    createManifest(targetPath, {
      manifest: {
        project: 'target',
        last_updated: '2026-03-21',
        installed: [],
      },
    });

    const app = Fastify({ logger: false });
    const discoveryService = new DiscoveryService();
    const registry = new InMemoryProjectRegistry();

    const originalCwd = process.cwd();
    process.chdir(baseDir);

    try {
      await registerProjectRoutes(app, discoveryService, registry);
      await app.ready();

      try {
        // Request with x-project-id=other trying to copy from source
        const response = await app.inject({
          method: 'POST',
          url: '/api/resources/copy-strategy',
          headers: {
            'x-project-id': 'other',
          },
          payload: {
            source_id: 'source',
            strategy_name: 'STRAT-001',
            target_ids: ['target'],
          },
        });

        assert.strictEqual(response.statusCode, 403);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.error, 'Access denied');
        assert(body.reason.includes('Cannot copy from project source'));
      } finally {
        await app.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(baseDir, { recursive: true });
  }
});
