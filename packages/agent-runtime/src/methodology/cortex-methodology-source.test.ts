/**
 * Unit tests for CortexMethodologySource — PRD-064 §13.1 acceptance
 * criteria.
 *
 * Run with: npm --workspace=@method/agent-runtime test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CortexMethodologySource,
  CortexMethodologyError,
  METHODOLOGIES_COLLECTION,
  METHODOLOGY_POLICY_COLLECTION,
  POLICY_SINGLETON_ID,
  METHODOLOGY_SIZE_CAP_BYTES,
} from './cortex-methodology-source.js';
import {
  FixtureStoragePort,
  FixtureEventBus,
  VALID_P_CUSTOM_YAML,
  BROKEN_YAML,
  G3_FAIL_YAML,
} from './test-fixtures.js';
import type { MethodologyPolicy } from './types.js';

function makeSource(opts: {
  bus?: FixtureEventBus;
  inheritance?: MethodologyPolicy['inheritance'];
  appId?: string;
} = {}) {
  const storage = new FixtureStoragePort();
  const bus = opts.bus;
  const appId = opts.appId ?? 'app-1';
  const source = new CortexMethodologySource({
    storage,
    events: bus?.port(appId),
    appId,
    inheritance: opts.inheritance ?? 'stdlib-plus-overrides',
    stdlibVersion: '1.0.0',
    methodtsVersion: '1.0.0',
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  });
  return { source, storage, bus };
}

// ── AC-1 ─────────────────────────────────────────────────────────

describe('CortexMethodologySource.init() — stdlib-plus-overrides', () => {
  it('AC-1: resolves stdlib ∪ per-app docs; per-app shadows stdlib', async () => {
    const { source } = makeSource();
    await source.init();
    // stdlib has P0-META, P1-EXEC, P2-SD, etc. — at least one is present
    const ids = source.list().map(e => e.methodologyId);
    assert.ok(ids.includes('P0-META'), 'stdlib P0-META must be listed');
    assert.ok(ids.includes('P2-SD'), 'stdlib P2-SD must be listed');

    // Upsert a per-app override.
    await source.upsert({
      methodologyId: 'P-CUSTOM',
      yaml: VALID_P_CUSTOM_YAML,
      updatedBy: 'alice',
    });
    const reloaded = source.list().map(e => e.methodologyId);
    assert.ok(reloaded.includes('P-CUSTOM'), 'per-app P-CUSTOM must be listed after upsert');
  });
});

// ── AC-2 ─────────────────────────────────────────────────────────

describe('CortexMethodologySource.upsert() — write-time gates', () => {
  it('AC-2a: rejects unparseable YAML with METHODOLOGY_PARSE_ERROR', async () => {
    const { source } = makeSource();
    await source.init();
    await assert.rejects(
      () =>
        source.upsert({
          methodologyId: 'BROKEN',
          yaml: BROKEN_YAML,
        }),
      (err: unknown) => {
        assert.ok(err instanceof CortexMethodologyError);
        assert.strictEqual((err as CortexMethodologyError).code, 'METHODOLOGY_PARSE_ERROR');
        return true;
      },
    );
  });

  it('AC-2b: rejects gate-fail YAML with METHODOLOGY_GATE_FAIL + report', async () => {
    const { source } = makeSource();
    await source.init();
    await assert.rejects(
      () =>
        source.upsert({
          methodologyId: 'P-NOARMS',
          yaml: G3_FAIL_YAML,
        }),
      (err: unknown) => {
        assert.ok(err instanceof CortexMethodologyError);
        assert.strictEqual((err as CortexMethodologyError).code, 'METHODOLOGY_GATE_FAIL');
        const report = (err as CortexMethodologyError).compilationReport;
        assert.ok(report, 'compilationReport must be attached');
        const g3 = report!.gates.find(g => g.gate === 'G3');
        assert.ok(g3, 'G3 entry present');
        assert.strictEqual(g3!.status, 'fail');
        return true;
      },
    );
  });

  it('persists the doc and runs G7 as pending', async () => {
    const { source, storage } = makeSource();
    await source.init();
    const doc = await source.upsert({
      methodologyId: 'P-CUSTOM',
      yaml: VALID_P_CUSTOM_YAML,
      updatedBy: 'alice',
    });
    assert.strictEqual(doc.compilationReport.overall, 'compiled');
    const g7 = doc.compilationReport.gates.find(g => g.gate === 'G7');
    assert.strictEqual(g7!.status, 'pending');
    // Persisted in the fixture storage.
    const persisted = await storage
      .collection(METHODOLOGIES_COLLECTION)
      .findOne({ _id: 'P-CUSTOM' });
    assert.ok(persisted, 'doc must be persisted');
  });

  it('rejects > 1MB YAML with METHODOLOGY_TOO_LARGE', async () => {
    const { source } = makeSource();
    await source.init();
    const big = VALID_P_CUSTOM_YAML + '\n' + 'x'.repeat(METHODOLOGY_SIZE_CAP_BYTES + 1);
    await assert.rejects(
      () => source.upsert({ methodologyId: 'BIG', yaml: big }),
      (err: unknown) =>
        err instanceof CortexMethodologyError &&
        err.code === 'METHODOLOGY_TOO_LARGE',
    );
  });
});

// ── AC-3 + AC-4 ──────────────────────────────────────────────────

describe('Hot-reload — dual path across replicas', () => {
  it('AC-3 + AC-4: upsert on replica A propagates to replica B idempotently', async () => {
    const bus = new FixtureEventBus();
    // Shared backing store so both replicas see the same Mongo data.
    const shared = new FixtureStoragePort();
    const a = new CortexMethodologySource({
      storage: shared,
      events: bus.port('app-1'),
      appId: 'app-1',
      inheritance: 'stdlib-plus-overrides',
      stdlibVersion: '1.0.0',
      methodtsVersion: '1.0.0',
      logger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    const b = new CortexMethodologySource({
      storage: shared,
      events: bus.port('app-1'),
      appId: 'app-1',
      inheritance: 'stdlib-plus-overrides',
      stdlibVersion: '1.0.0',
      methodtsVersion: '1.0.0',
      logger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    await a.init();
    await b.init();

    let bOnChangeFires = 0;
    b.onChange(() => {
      bOnChangeFires += 1;
    });

    const doc = await a.upsert({
      methodologyId: 'P-CUSTOM',
      yaml: VALID_P_CUSTOM_YAML,
      updatedBy: 'alice',
    });

    // Replica B should have been notified via the event bus subscription.
    assert.ok(bOnChangeFires >= 1, 'B.onChange must have fired at least once');

    // Idempotency: duplicate event at the same version is dropped.
    const beforeDupFires = bOnChangeFires;
    await bus.port('app-1').emit('methodology.updated', {
      appId: 'app-1',
      methodologyId: 'P-CUSTOM',
      version: doc.version,
      kind: 'upsert',
    });
    assert.strictEqual(
      bOnChangeFires,
      beforeDupFires,
      'duplicate same-version emit must be dropped',
    );

    // Version visible on both.
    assert.strictEqual(
      a.list().find(e => e.methodologyId === 'P-CUSTOM')?.version,
      doc.version,
    );
    assert.strictEqual(
      b.list().find(e => e.methodologyId === 'P-CUSTOM')?.version,
      doc.version,
    );
  });
});

// ── AC-5 ─────────────────────────────────────────────────────────

describe('setPolicy — promotion-only (AC-5)', () => {
  it('rejects demotion with POLICY_DEMOTION_REJECTED', async () => {
    const { source } = makeSource({ inheritance: 'stdlib-plus-overrides' });
    await source.init();
    await assert.rejects(
      () =>
        source.setPolicy({
          _id: POLICY_SINGLETON_ID,
          inheritance: 'stdlib-read-only',
          updatedAt: '',
          updatedBy: 'alice',
        }),
      (err: unknown) =>
        err instanceof CortexMethodologyError &&
        err.code === 'POLICY_DEMOTION_REJECTED',
    );
  });

  it('accepts promotion from stdlib-read-only to stdlib-plus-overrides', async () => {
    const { source } = makeSource({ inheritance: 'stdlib-read-only' });
    await source.init();
    const updated = await source.setPolicy({
      _id: POLICY_SINGLETON_ID,
      inheritance: 'stdlib-plus-overrides',
      updatedAt: '',
      updatedBy: 'alice',
    });
    assert.strictEqual(updated.inheritance, 'stdlib-plus-overrides');
  });
});

// ── AC-6 ─────────────────────────────────────────────────────────

describe('pinFromStdlib (AC-6)', () => {
  it('creates a stdlib-pinned doc snapshotting current stdlib version', async () => {
    const { source } = makeSource();
    await source.init();
    // Pick a stdlib methodology known to exist.
    const doc = await source.pinFromStdlib('P1-EXEC');
    assert.strictEqual(doc.source, 'stdlib-pinned');
    assert.strictEqual(doc.parent?.stdlibVersion, '1.0.0');
    assert.ok(doc.yaml.length > 0, 'yaml stub is emitted');
  });

  it('rejects pinning an unknown methodology with STDLIB_ENTRY_NOT_FOUND', async () => {
    const { source } = makeSource();
    await source.init();
    await assert.rejects(
      () => source.pinFromStdlib('P-NOT-A-REAL-THING'),
      (err: unknown) =>
        err instanceof CortexMethodologyError &&
        err.code === 'STDLIB_ENTRY_NOT_FOUND',
    );
  });
});

// ── AC-7 ─────────────────────────────────────────────────────────

describe('remove (AC-7)', () => {
  it('rejects removing a stdlib-only entry with STDLIB_ENTRY_NOT_REMOVABLE', async () => {
    const { source } = makeSource();
    await source.init();
    await assert.rejects(
      () => source.remove('P0-META'),
      (err: unknown) =>
        err instanceof CortexMethodologyError &&
        err.code === 'STDLIB_ENTRY_NOT_REMOVABLE',
    );
  });

  it('removes an existing per-app doc', async () => {
    const { source, storage } = makeSource();
    await source.init();
    await source.upsert({
      methodologyId: 'P-CUSTOM',
      yaml: VALID_P_CUSTOM_YAML,
    });
    await source.remove('P-CUSTOM');
    const persisted = await storage
      .collection(METHODOLOGIES_COLLECTION)
      .findOne({ _id: 'P-CUSTOM' });
    assert.strictEqual(persisted, null);
  });
});

// ── AC-8 ─────────────────────────────────────────────────────────

describe('validate (AC-8)', () => {
  it('runs gates but does NOT persist', async () => {
    const { source, storage } = makeSource();
    await source.init();
    const writesBefore = storage.callCounts.updateOne;
    const report = await source.validate({
      methodologyId: 'P-CUSTOM',
      yaml: VALID_P_CUSTOM_YAML,
    });
    assert.strictEqual(report.overall, 'compiled');
    assert.strictEqual(
      storage.callCounts.updateOne,
      writesBefore,
      'validate() must not write',
    );
  });
});

// ── Policy read-only blocks writes ───────────────────────────────

describe('stdlib-read-only mode', () => {
  it('upsert / remove throw POLICY_READ_ONLY', async () => {
    const { source } = makeSource({ inheritance: 'stdlib-read-only' });
    await source.init();
    await assert.rejects(
      () => source.upsert({ methodologyId: 'P-CUSTOM', yaml: VALID_P_CUSTOM_YAML }),
      (err: unknown) =>
        err instanceof CortexMethodologyError && err.code === 'POLICY_READ_ONLY',
    );
  });
});

// ── Indexes declared + policy bootstrap ──────────────────────────

describe('indexes + policy bootstrap', () => {
  it('creates the two declared indexes on init', async () => {
    const { source, storage } = makeSource();
    await source.init();
    const idx = storage.indexes.get(METHODOLOGIES_COLLECTION) ?? [];
    const names = idx.map(i => i.name);
    assert.ok(names.includes('idx_methodology_id'));
    assert.ok(names.includes('idx_status'));
  });

  it('getPolicy returns the default when no policy is persisted', async () => {
    const { source, storage } = makeSource();
    await source.init();
    const policy = await source.getPolicy();
    assert.strictEqual(policy.inheritance, 'stdlib-plus-overrides');
    assert.strictEqual(policy._id, POLICY_SINGLETON_ID);
    // Not yet persisted — until setPolicy is called.
    const persisted = await storage
      .collection(METHODOLOGY_POLICY_COLLECTION)
      .findOne({ _id: POLICY_SINGLETON_ID });
    assert.strictEqual(persisted, null);
  });
});
