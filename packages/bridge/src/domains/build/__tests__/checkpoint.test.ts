/**
 * Checkpoint adapter tests — save/load roundtrip, serialization fidelity.
 *
 * Uses real temp directories and js-yaml (via JsYamlLoader) to validate
 * that FeatureSpec and conversationHistory survive YAML serialization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { FileCheckpointAdapter } from '../checkpoint-adapter.js';
import { NodeFileSystemProvider } from '../../../ports/file-system.js';
import { JsYamlLoader } from '../../../ports/yaml-loader.js';
import type { PipelineCheckpoint } from '../../../ports/checkpoint.js';

describe('FileCheckpointAdapter', () => {
  let tmpDir: string;
  let adapter: FileCheckpointAdapter;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    adapter = new FileCheckpointAdapter(
      tmpDir,
      new NodeFileSystemProvider(),
      new JsYamlLoader(),
    );
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup best-effort */ }
  });

  it('save/load roundtrip preserves checkpoint data', async () => {
    const checkpoint: PipelineCheckpoint = {
      sessionId: 'test-session-001',
      phase: 'design',
      completedStrategies: ['explore-codebase', 'specify-feature'],
      artifactManifest: { 'src/index.ts': 'created' },
      featureSpec: {
        requirement: 'Add user authentication',
        problem: 'No auth system exists',
        criteria: [
          { name: 'login-endpoint', type: 'command', check: 'curl localhost:3000/login', expect: 'exit 0' },
          { name: 'types-compile', type: 'typescript', check: 'npx tsc --noEmit', expect: '0' },
        ],
        scope: { in: ['auth'], out: ['billing'] },
        constraints: ['Must use existing session port'],
      },
      costAccumulator: { tokens: 15000, usd: 0.45 },
      conversationHistory: [
        {
          id: 'msg-1',
          sender: 'agent',
          content: 'Exploration complete.',
          timestamp: '2026-04-03T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          sender: 'human',
          content: 'Looks good, proceed.',
          timestamp: '2026-04-03T10:01:00.000Z',
          replyTo: 'msg-1',
        },
      ],
      savedAt: '2026-04-03T10:02:00.000Z',
    };

    await adapter.save('test-session-001', checkpoint);
    const loaded = await adapter.load('test-session-001');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('test-session-001');
    expect(loaded!.phase).toBe('design');
    expect(loaded!.completedStrategies).toEqual(['explore-codebase', 'specify-feature']);
    expect(loaded!.artifactManifest).toEqual({ 'src/index.ts': 'created' });
    expect(loaded!.costAccumulator).toEqual({ tokens: 15000, usd: 0.45 });
    expect(loaded!.savedAt).toBe('2026-04-03T10:02:00.000Z');
  });

  it('FeatureSpec survives serialization with all fields', async () => {
    const checkpoint: PipelineCheckpoint = {
      sessionId: 'test-spec',
      phase: 'specify',
      completedStrategies: [],
      artifactManifest: {},
      featureSpec: {
        requirement: 'Build search feature',
        problem: 'Users cannot find content',
        criteria: [
          { name: 'search-returns-results', type: 'grep', check: 'searchResults', expect: 'src/' },
          { name: 'endpoint-exists', type: 'endpoint', check: '/api/search', expect: '200' },
          { name: 'custom-check', type: 'custom', check: 'validate-index', expect: 'pass' },
        ],
        scope: { in: ['search', 'indexing'], out: ['auth'] },
        constraints: ['Must use existing DB port', 'Max 100ms response time'],
      },
      costAccumulator: { tokens: 0, usd: 0 },
      conversationHistory: [],
      savedAt: '2026-04-03T11:00:00.000Z',
    };

    await adapter.save('test-spec', checkpoint);
    const loaded = await adapter.load('test-spec');

    expect(loaded!.featureSpec).toBeDefined();
    expect(loaded!.featureSpec!.requirement).toBe('Build search feature');
    expect(loaded!.featureSpec!.problem).toBe('Users cannot find content');
    expect(loaded!.featureSpec!.criteria).toHaveLength(3);
    expect(loaded!.featureSpec!.criteria[0].type).toBe('grep');
    expect(loaded!.featureSpec!.criteria[1].type).toBe('endpoint');
    expect(loaded!.featureSpec!.criteria[2].type).toBe('custom');
    expect(loaded!.featureSpec!.scope.in).toEqual(['search', 'indexing']);
    expect(loaded!.featureSpec!.scope.out).toEqual(['auth']);
    expect(loaded!.featureSpec!.constraints).toEqual(['Must use existing DB port', 'Max 100ms response time']);
  });

  it('conversationHistory survives serialization with threading', async () => {
    const checkpoint: PipelineCheckpoint = {
      sessionId: 'test-convo',
      phase: 'review',
      completedStrategies: ['explore', 'specify', 'design', 'plan', 'implement'],
      artifactManifest: {},
      costAccumulator: { tokens: 50000, usd: 1.50 },
      conversationHistory: [
        {
          id: 'sys-1',
          sender: 'system',
          content: 'Build started',
          timestamp: '2026-04-03T09:00:00.000Z',
        },
        {
          id: 'agent-1',
          sender: 'agent',
          content: 'I found 3 domains relevant to this feature.',
          timestamp: '2026-04-03T09:01:00.000Z',
        },
        {
          id: 'human-1',
          sender: 'human',
          content: 'What about the cluster domain?',
          timestamp: '2026-04-03T09:02:00.000Z',
          replyTo: 'agent-1',
        },
      ],
      savedAt: '2026-04-03T09:05:00.000Z',
    };

    await adapter.save('test-convo', checkpoint);
    const loaded = await adapter.load('test-convo');

    expect(loaded!.conversationHistory).toHaveLength(3);
    expect(loaded!.conversationHistory[0].sender).toBe('system');
    expect(loaded!.conversationHistory[1].sender).toBe('agent');
    expect(loaded!.conversationHistory[2].sender).toBe('human');
    expect(loaded!.conversationHistory[2].replyTo).toBe('agent-1');
  });

  it('load returns null for non-existent session', async () => {
    const result = await adapter.load('nonexistent-session');
    expect(result).toBeNull();
  });

  it('list returns summaries for all saved checkpoints', async () => {
    const base: PipelineCheckpoint = {
      sessionId: '',
      phase: 'explore',
      completedStrategies: [],
      artifactManifest: {},
      featureSpec: { requirement: '', problem: '', criteria: [], scope: { in: [], out: [] }, constraints: [] },
      costAccumulator: { tokens: 0, usd: 0 },
      conversationHistory: [],
      savedAt: '',
    };

    await adapter.save('session-a', {
      ...base,
      sessionId: 'session-a',
      phase: 'design',
      featureSpec: { ...base.featureSpec!, requirement: 'Feature A' },
      costAccumulator: { tokens: 1000, usd: 0.10 },
      savedAt: '2026-04-03T10:00:00.000Z',
    });

    await adapter.save('session-b', {
      ...base,
      sessionId: 'session-b',
      phase: 'validate',
      featureSpec: { ...base.featureSpec!, requirement: 'Feature B' },
      costAccumulator: { tokens: 5000, usd: 0.50 },
      savedAt: '2026-04-03T11:00:00.000Z',
    });

    const summaries = await adapter.list();
    expect(summaries).toHaveLength(2);

    const sessionA = summaries.find(s => s.sessionId === 'session-a');
    const sessionB = summaries.find(s => s.sessionId === 'session-b');

    expect(sessionA).toBeDefined();
    expect(sessionA!.phase).toBe('design');
    expect(sessionA!.requirement).toBe('Feature A');

    expect(sessionB).toBeDefined();
    expect(sessionB!.phase).toBe('validate');
    expect(sessionB!.requirement).toBe('Feature B');
  });

  it('list returns empty array when checkpoint dir does not exist', async () => {
    const missingDir = join(tmpDir, 'nonexistent');
    const missingAdapter = new FileCheckpointAdapter(
      missingDir,
      new NodeFileSystemProvider(),
      new JsYamlLoader(),
    );
    const summaries = await missingAdapter.list();
    expect(summaries).toEqual([]);
  });

  it('save overwrites previous checkpoint for same session', async () => {
    const checkpoint1: PipelineCheckpoint = {
      sessionId: 'overwrite-test',
      phase: 'explore',
      completedStrategies: [],
      artifactManifest: {},
      costAccumulator: { tokens: 100, usd: 0.01 },
      conversationHistory: [],
      savedAt: '2026-04-03T10:00:00.000Z',
    };

    const checkpoint2: PipelineCheckpoint = {
      ...checkpoint1,
      phase: 'implement',
      completedStrategies: ['explore', 'specify', 'design', 'plan'],
      costAccumulator: { tokens: 50000, usd: 1.50 },
      savedAt: '2026-04-03T12:00:00.000Z',
    };

    await adapter.save('overwrite-test', checkpoint1);
    await adapter.save('overwrite-test', checkpoint2);

    const loaded = await adapter.load('overwrite-test');
    expect(loaded!.phase).toBe('implement');
    expect(loaded!.costAccumulator.tokens).toBe(50000);
    expect(loaded!.savedAt).toBe('2026-04-03T12:00:00.000Z');
  });
});
