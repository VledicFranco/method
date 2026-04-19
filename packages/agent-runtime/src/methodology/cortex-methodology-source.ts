// SPDX-License-Identifier: Apache-2.0
/**
 * CortexMethodologySource — Cortex-backed MethodologySource (PRD-064 / S7).
 *
 * Implements the read-side of the frozen `MethodologySource` port plus the
 * admin-only methods (`upsert`/`remove`/`validate`/`pinFromStdlib`/
 * `setPolicy`/`getPolicy`/`getMethodologyDocument`/`listDocuments`) that the
 * Cortex-side `PlatformMethodologyApi` route layer will bind verbatim.
 *
 * The class hydrates an in-memory cache in `init()` (stdlib ∪ per-app docs)
 * and serves the three synchronous reads from that cache. Writes run the
 * G1-G6 compilation gates before persisting; the stored `compilationReport`
 * is the trust anchor for load-time validation.
 *
 * Hot reload is dual-path (PRD-064 §6.2): the writing replica updates its
 * own cache synchronously before emitting `methodology.updated`, so the
 * admin's next read sees the edit immediately; other replicas pick it up
 * via the subscription handler, which is idempotent via version check.
 */

import type {
  MethodologySource,
  MethodologyChange,
} from '@methodts/runtime/ports';
import type {
  CatalogMethodologyEntry,
} from '@methodts/methodts/stdlib';
import type { Method, Methodology } from '@methodts/methodts';
import {
  getStdlibCatalog,
  getMethod as getStdlibMethod,
  getMethodology as getStdlibMethodology,
} from '@methodts/methodts/stdlib';

import type {
  MethodologyDocument,
  MethodologyDocumentInput,
  MethodologyDocumentSummary,
  MethodologyPolicy,
  MethodologyInheritance,
  CompilationReport,
  CortexMethodologyErrorCode,
} from './types.js';
import type { CortexStoragePort } from './cortex-storage-port.js';
import type {
  CortexEventsPort,
  EventEnvelope,
  EventUnsubscribe,
  MethodologyUpdatedPayload,
} from './cortex-events-port.js';
import {
  resolveCache,
  isPromotion,
  type CacheEntry,
  type ResolvedCache,
} from './inheritance-resolver.js';
import {
  runWriteTimeGates,
  recheckG6Only,
  extractMetadata,
  METHODTS_VERSION_SENTINEL,
} from './gate-runner.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethod = Method<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethodology = Methodology<any>;

// ── Constants ─────────────────────────────────────────────────────

export const METHODOLOGIES_COLLECTION = 'methodologies';
export const METHODOLOGY_POLICY_COLLECTION = 'methodology_policy';
export const POLICY_SINGLETON_ID = 'policy' as const;

/** 1 MB soft cap per PRD-064 R-3 mitigation. */
export const METHODOLOGY_SIZE_CAP_BYTES = 1_000_000;

// ── Error ─────────────────────────────────────────────────────────

/** Thrown by admin methods; the route layer maps `code` to an HTTP status. */
export class CortexMethodologyError extends Error {
  readonly code: CortexMethodologyErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly compilationReport?: CompilationReport;

  constructor(
    code: CortexMethodologyErrorCode,
    message: string,
    extra?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly compilationReport?: CompilationReport;
    },
  ) {
    super(message);
    this.name = 'CortexMethodologyError';
    this.code = code;
    this.details = extra?.details;
    this.compilationReport = extra?.compilationReport;
  }
}

// ── Internal "stdlib" pass-through MethodologySource ──────────────

/**
 * Minimal stdlib-backed MethodologySource used inside the inheritance
 * resolver. We avoid importing `StdlibSource` from `@methodts/bridge`
 * (would break layering); the stdlib catalog is a pure function in
 * `@methodts/methodts`.
 */
class InternalStdlibSource implements MethodologySource {
  list(): CatalogMethodologyEntry[] {
    return getStdlibCatalog();
  }
  getMethod(methodologyId: string, methodId: string): AnyMethod | undefined {
    return getStdlibMethod(methodologyId, methodId);
  }
  getMethodology(methodologyId: string): AnyMethodology | undefined {
    return getStdlibMethodology(methodologyId);
  }
}

// ── Deps ──────────────────────────────────────────────────────────

export interface CortexMethodologySourceDeps {
  readonly storage: CortexStoragePort;
  /** Optional — if absent, hot-reload falls back to explicit reload() calls. */
  readonly events?: CortexEventsPort;
  readonly appId: string;
  /** Default: 'stdlib-plus-overrides'. Can be overridden by persisted policy. */
  readonly inheritance?: MethodologyInheritance;
  /** Stdlib version pin — falls back to "unknown". */
  readonly stdlibVersion?: string;
  /** Runtime methodts version for load-time drift detection. */
  readonly methodtsVersion?: string;
  readonly logger?: Pick<Console, 'warn' | 'error' | 'info'>;
  /**
   * Author id persisted on write audit fields when the caller supplies no
   * explicit `updatedBy`. Defaults to `"system"`.
   */
  readonly defaultActor?: string;
}

// ── The class ─────────────────────────────────────────────────────

export class CortexMethodologySource implements MethodologySource {
  private readonly storage: CortexStoragePort;
  private readonly events: CortexEventsPort | undefined;
  private readonly appId: string;
  private readonly defaultInheritance: MethodologyInheritance;
  private readonly stdlibVersion: string;
  private readonly methodtsVersion: string;
  private readonly logger: Pick<Console, 'warn' | 'error' | 'info'>;
  private readonly defaultActor: string;
  private readonly internalStdlib: InternalStdlibSource;

  private cache: ResolvedCache = {
    entries: new Map(),
    perAppMethods: new Map(),
  };
  private policy: MethodologyPolicy | null = null;
  private eventUnsubscribe: EventUnsubscribe | void = undefined;
  private readonly listeners = new Set<(c: MethodologyChange) => void>();
  private initialized = false;

  constructor(deps: CortexMethodologySourceDeps) {
    this.storage = deps.storage;
    this.events = deps.events;
    this.appId = deps.appId;
    this.defaultInheritance = deps.inheritance ?? 'stdlib-plus-overrides';
    this.stdlibVersion = deps.stdlibVersion ?? 'unknown';
    this.methodtsVersion = deps.methodtsVersion ?? METHODTS_VERSION_SENTINEL;
    this.logger = deps.logger ?? console;
    this.defaultActor = deps.defaultActor ?? 'system';
    this.internalStdlib = new InternalStdlibSource();
  }

  // ── Port: core reads (synchronous hot path) ─────────────────────

  list(): CatalogMethodologyEntry[] {
    return [...this.cache.entries.values()].map(e => e.entry);
  }

  getMethod(methodologyId: string, methodId: string): AnyMethod | undefined {
    const entry = this.cache.entries.get(methodologyId);
    if (!entry) return undefined;

    // Stdlib source — delegate to the compile-time method lookup.
    if (entry.source === 'stdlib') {
      return this.internalStdlib.getMethod(methodologyId, methodId);
    }

    // Per-app / pinned — method bodies are not represented at methodology
    // scope in the v1 YAML schema (methods live in their own files).
    // Fall back to stdlib lookup if the methodologyId matches stdlib.
    // This keeps `getMethod` useful for stdlib-inherited methods even when
    // the methodology shell was overridden.
    const perApp = this.cache.perAppMethods.get(
      `${methodologyId}/${methodId}`,
    );
    if (perApp) return perApp;
    return this.internalStdlib.getMethod(methodologyId, methodId);
  }

  getMethodology(methodologyId: string): AnyMethodology | undefined {
    const entry = this.cache.entries.get(methodologyId);
    if (!entry) return undefined;
    if (entry.parsed) return entry.parsed;
    return this.internalStdlib.getMethodology(methodologyId);
  }

  // ── Port: lifecycle ──────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.ensureIndexes();
    await this.rebuild();
    this.subscribeToEvents();
    this.initialized = true;
  }

  async reload(methodologyId?: string): Promise<void> {
    if (methodologyId == null) {
      await this.rebuild();
      this.notify({ kind: 'reloaded', reason: 'full' });
      return;
    }
    // Targeted reload — re-read one doc and patch the cache.
    const policy = await this.ensurePolicy();
    if (policy.inheritance === 'stdlib-read-only') {
      // No per-app docs visible; nothing to reload.
      return;
    }
    const doc = await this.storage
      .collection<MethodologyDocument>(METHODOLOGIES_COLLECTION)
      .findOne({ _id: methodologyId });
    const prev = this.cache.entries.get(methodologyId);
    if (!doc) {
      // Doc removed — fall back to stdlib if inheritance allows.
      if (policy.inheritance === 'per-app-only') {
        this.cache.entries.delete(methodologyId);
        this.notify({ kind: 'removed', methodologyId });
      } else {
        // Recompute from stdlib for this id.
        await this.rebuild();
        this.notify({ kind: 'removed', methodologyId });
      }
      return;
    }

    // Re-run load-time G6 if pinned methodts version differs.
    if (doc.compilationReport.methodtsVersion !== this.methodtsVersion) {
      const g6 = recheckG6Only(doc.yaml);
      if (g6.status === 'fail') {
        this.logger.warn?.(
          `[methodology-source] doc ${doc.methodologyId} failed G6 re-check on load`,
        );
        this.cache.entries.delete(methodologyId);
        return;
      }
    }

    // Replace the cache entry in place.
    await this.rebuild();
    if (prev) {
      this.notify({
        kind: 'updated',
        methodologyId,
        version: doc.version,
        previousVersion: prev.version,
      });
    } else {
      this.notify({ kind: 'added', methodologyId, version: doc.version });
    }
  }

  onChange(listener: (c: MethodologyChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    if (typeof this.eventUnsubscribe === 'function') {
      await this.eventUnsubscribe();
    }
    this.eventUnsubscribe = undefined;
    this.initialized = false;
  }

  // ── Admin methods ────────────────────────────────────────────────

  /** Full persisted doc (admin UI detail view). */
  async getMethodologyDocument(
    methodologyId: string,
  ): Promise<MethodologyDocument | null> {
    return this.storage
      .collection<MethodologyDocument>(METHODOLOGIES_COLLECTION)
      .findOne({ _id: methodologyId });
  }

  /**
   * Summary rows for the admin list view. Merges stdlib + per-app docs
   * under the current policy — this is what the admin UI's table shows.
   */
  async listDocuments(): Promise<ReadonlyArray<MethodologyDocumentSummary>> {
    const rows: MethodologyDocumentSummary[] = [];
    for (const [id, entry] of this.cache.entries) {
      rows.push({
        methodologyId: id,
        version: entry.version,
        source:
          entry.source === 'stdlib'
            ? 'stdlib'
            : entry.source === 'per-app'
              ? 'per-app'
              : entry.source === 'pinned-drifted'
                ? 'pinned-drifted'
                : 'stdlib-pinned',
        status:
          (entry.doc?.status ?? (entry.entry.status as 'compiled')) === 'deprecated'
            ? 'deprecated'
            : entry.doc?.status === 'draft'
              ? 'draft'
              : 'compiled',
        gateSummary: (() => {
          const report = entry.doc?.compilationReport;
          if (!report) return { overall: 'not-run' as const, failingGates: [] };
          const failing = report.gates
            .filter(g => g.status === 'fail')
            .map(g => g.gate);
          return { overall: report.overall, failingGates: failing };
        })(),
      });
    }
    return rows;
  }

  /**
   * Dry-run compilation — runs gates but does NOT persist. Used by the
   * admin UI's "validate" action and the upsert path.
   */
  async validate(
    input: MethodologyDocumentInput,
  ): Promise<CompilationReport> {
    await this.enforceNotReadOnly();
    this.enforceSize(input.yaml);
    const { report } = runWriteTimeGates(input.yaml, {
      allowNeedsReview: input.allowNeedsReview,
      methodtsVersion: this.methodtsVersion,
    });
    return report;
  }

  /** Admin upsert — blocks on gate failure; emits `methodology.updated`. */
  async upsert(
    input: MethodologyDocumentInput,
  ): Promise<MethodologyDocument> {
    await this.enforceNotReadOnly();
    this.enforceSize(input.yaml);

    const { parsed, report } = runWriteTimeGates(input.yaml, {
      allowNeedsReview: input.allowNeedsReview,
      methodtsVersion: this.methodtsVersion,
    });
    if (report.overall === 'failed' || parsed == null) {
      throw new CortexMethodologyError(
        parsed == null ? 'METHODOLOGY_PARSE_ERROR' : 'METHODOLOGY_GATE_FAIL',
        parsed == null
          ? `YAML failed to parse for methodology ${input.methodologyId}`
          : `Write-time gate failure for methodology ${input.methodologyId}`,
        { compilationReport: report },
      );
    }

    const now = new Date().toISOString();
    const collection = this.storage.collection<MethodologyDocument>(
      METHODOLOGIES_COLLECTION,
    );
    const existing = await collection.findOne({ _id: input.methodologyId });
    const version = bumpVersion(existing?.version);
    const metadata = extractMetadata(input.yaml, parsed);

    const doc: MethodologyDocument = {
      _id: input.methodologyId,
      methodologyId: input.methodologyId,
      version,
      source: existing?.source ?? 'per-app',
      ...(existing?.parent ? { parent: existing.parent } : {}),
      status:
        report.overall === 'needs_review' ? 'draft' : 'compiled',
      yaml: input.yaml,
      metadata: {
        name: metadata.name,
        description: metadata.description,
        methods: metadata.methods,
      },
      compilationReport: report,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? input.updatedBy ?? this.defaultActor,
      updatedAt: now,
      updatedBy: input.updatedBy ?? this.defaultActor,
    };

    await collection.updateOne(
      { _id: input.methodologyId },
      { $set: doc },
      { upsert: true },
    );

    // ── Sync cache update on writing replica BEFORE emit ──────────
    await this.rebuild();
    if (existing) {
      this.notify({
        kind: 'updated',
        methodologyId: input.methodologyId,
        version,
        previousVersion: existing.version,
      });
    } else {
      this.notify({
        kind: 'added',
        methodologyId: input.methodologyId,
        version,
      });
    }

    // ── Fan out to other replicas via ctx.events ──────────────────
    if (this.events) {
      await this.events.emit('methodology.updated', {
        appId: this.appId,
        methodologyId: input.methodologyId,
        version,
        kind: 'upsert',
      });
    }

    return doc;
  }

  /** Remove a per-app doc. stdlib-only entries cannot be removed. */
  async remove(methodologyId: string): Promise<void> {
    await this.enforceNotReadOnly();
    const collection = this.storage.collection<MethodologyDocument>(
      METHODOLOGIES_COLLECTION,
    );
    const existing = await collection.findOne({ _id: methodologyId });
    if (!existing) {
      // Not present in per-app docs — check stdlib; if present there, reject.
      if (this.internalStdlib.list().some(e => e.methodologyId === methodologyId)) {
        throw new CortexMethodologyError(
          'STDLIB_ENTRY_NOT_REMOVABLE',
          `Methodology ${methodologyId} is a stdlib entry and cannot be removed.`,
        );
      }
      throw new CortexMethodologyError(
        'STDLIB_ENTRY_NOT_FOUND',
        `Methodology ${methodologyId} not found.`,
      );
    }
    await collection.deleteOne({ _id: methodologyId });
    await this.rebuild();
    this.notify({ kind: 'removed', methodologyId });

    if (this.events) {
      await this.events.emit('methodology.updated', {
        appId: this.appId,
        methodologyId,
        version: existing.version,
        kind: 'remove',
      });
    }
  }

  /** Snapshot the live stdlib entry into a `stdlib-pinned` per-app doc. */
  async pinFromStdlib(methodologyId: string): Promise<MethodologyDocument> {
    await this.enforceNotReadOnly();
    const entry = this.internalStdlib
      .list()
      .find(e => e.methodologyId === methodologyId);
    if (!entry) {
      throw new CortexMethodologyError(
        'STDLIB_ENTRY_NOT_FOUND',
        `Stdlib methodology ${methodologyId} not found.`,
      );
    }
    // Stdlib entries come from compile-time code, not YAML; emit a
    // minimal YAML stub so the pin is round-trippable. The admin UI can
    // then edit this if they wish.
    const yamlStub = stdlibStubYaml(entry);
    const now = new Date().toISOString();
    const doc: MethodologyDocument = {
      _id: methodologyId,
      methodologyId,
      version: `${entry.version}-pinned-1`,
      source: 'stdlib-pinned',
      parent: { methodologyId, stdlibVersion: this.stdlibVersion },
      status: 'compiled',
      yaml: yamlStub,
      metadata: {
        name: entry.name,
        description: entry.description,
        methods: entry.methods.map(m => ({ ...m })),
      },
      compilationReport: {
        overall: 'compiled',
        gates: (['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const).map(g => ({
          gate: g,
          status: 'pass' as const,
          details: 'Pinned from stdlib — trusted.',
        })),
        compiledAt: now,
        methodtsVersion: this.methodtsVersion,
      },
      createdAt: now,
      createdBy: this.defaultActor,
      updatedAt: now,
      updatedBy: this.defaultActor,
    };

    await this.storage
      .collection<MethodologyDocument>(METHODOLOGIES_COLLECTION)
      .updateOne({ _id: methodologyId }, { $set: doc }, { upsert: true });

    await this.rebuild();
    this.notify({ kind: 'updated', methodologyId, version: doc.version, previousVersion: entry.version });
    if (this.events) {
      await this.events.emit('methodology.updated', {
        appId: this.appId,
        methodologyId,
        version: doc.version,
        kind: 'upsert',
      });
    }
    return doc;
  }

  /** Fetch the policy singleton (synthesizes default if absent). */
  async getPolicy(): Promise<MethodologyPolicy> {
    return this.ensurePolicy();
  }

  /**
   * Replace the policy singleton. Enforces PRD-064 §9.1 promotion-only
   * rule on the `inheritance` field.
   */
  async setPolicy(policy: MethodologyPolicy): Promise<MethodologyPolicy> {
    const current = await this.ensurePolicy();
    if (!isPromotion(current.inheritance, policy.inheritance)) {
      throw new CortexMethodologyError(
        'POLICY_DEMOTION_REJECTED',
        `Policy demotion rejected: ${current.inheritance} → ${policy.inheritance}. ` +
          'Uninstall + reinstall the app to change inheritance mode.',
        { details: { from: current.inheritance, to: policy.inheritance } },
      );
    }
    const now = new Date().toISOString();
    const merged: MethodologyPolicy = {
      ...policy,
      _id: POLICY_SINGLETON_ID,
      updatedAt: now,
      updatedBy: policy.updatedBy ?? this.defaultActor,
    };
    await this.storage
      .collection<MethodologyPolicy>(METHODOLOGY_POLICY_COLLECTION)
      .updateOne(
        { _id: POLICY_SINGLETON_ID },
        { $set: merged },
        { upsert: true },
      );
    this.policy = merged;
    await this.rebuild();
    this.notify({ kind: 'reloaded', reason: 'bulk-admin-edit' });

    if (this.events) {
      // Policy changes emit too (one event type only, per manifest).
      await this.events.emit('methodology.updated', {
        appId: this.appId,
        methodologyId: '__policy__',
        version: now,
        kind: 'policy',
      });
    }
    return merged;
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private async ensureIndexes(): Promise<void> {
    try {
      await this.storage
        .collection(METHODOLOGIES_COLLECTION)
        .createIndex({
          name: 'idx_methodology_id',
          fields: [{ name: 'methodologyId', direction: 'Asc' }],
          unique: true,
        });
      await this.storage
        .collection(METHODOLOGIES_COLLECTION)
        .createIndex({
          name: 'idx_status',
          fields: [{ name: 'status', direction: 'Asc' }],
        });
    } catch (err) {
      this.logger.warn?.(
        `[methodology-source] index creation warning: ${(err as Error).message}`,
      );
    }
  }

  private async ensurePolicy(): Promise<MethodologyPolicy> {
    if (this.policy) return this.policy;
    const existing = await this.storage
      .collection<MethodologyPolicy>(METHODOLOGY_POLICY_COLLECTION)
      .findOne({ _id: POLICY_SINGLETON_ID });
    if (existing) {
      this.policy = existing;
      return existing;
    }
    const seeded: MethodologyPolicy = {
      _id: POLICY_SINGLETON_ID,
      inheritance: this.defaultInheritance,
      updatedAt: new Date().toISOString(),
      updatedBy: this.defaultActor,
    };
    this.policy = seeded;
    return seeded;
  }

  private async rebuild(): Promise<void> {
    const policy = await this.ensurePolicy();
    let perAppDocs: ReadonlyArray<MethodologyDocument> = [];
    if (policy.inheritance !== 'stdlib-read-only') {
      perAppDocs = await this.storage
        .collection<MethodologyDocument>(METHODOLOGIES_COLLECTION)
        .find({}, { limit: 1000 });
    }

    // Load-time G6 re-check on methodts-version drift (PRD-064 §8).
    const filtered: MethodologyDocument[] = [];
    for (const doc of perAppDocs) {
      if (doc.compilationReport.methodtsVersion !== this.methodtsVersion) {
        const g6 = recheckG6Only(doc.yaml);
        if (g6.status === 'fail') {
          this.logger.warn?.(
            `[methodology-source] doc ${doc.methodologyId} excluded: G6 re-check failed on methodts drift`,
          );
          continue;
        }
      }
      filtered.push(doc);
    }

    this.cache = resolveCache({
      stdlib: this.internalStdlib,
      stdlibVersion: this.stdlibVersion,
      policy,
      perAppDocs: filtered,
      logger: this.logger,
    });
  }

  private subscribeToEvents(): void {
    if (!this.events) return;
    const maybe = this.events.on(
      'methodology.updated',
      async (envelope: EventEnvelope<MethodologyUpdatedPayload>) => {
        if (envelope.payload.appId !== this.appId) return;
        const incomingVersion = envelope.payload.version;
        const existingEntry = this.cache.entries.get(
          envelope.payload.methodologyId,
        );
        if (
          existingEntry !== undefined &&
          existingEntry.version === incomingVersion &&
          envelope.payload.kind !== 'policy'
        ) {
          // Idempotent drop — we already have this version.
          return;
        }
        if (envelope.payload.kind === 'policy') {
          // Invalidate policy + rebuild.
          this.policy = null;
          await this.rebuild();
          this.notify({ kind: 'reloaded', reason: 'bulk-admin-edit' });
          return;
        }
        await this.reload(envelope.payload.methodologyId);
      },
    );
    this.eventUnsubscribe = maybe ?? undefined;
  }

  private async enforceNotReadOnly(): Promise<void> {
    const policy = await this.ensurePolicy();
    if (policy.inheritance === 'stdlib-read-only') {
      throw new CortexMethodologyError(
        'POLICY_READ_ONLY',
        'Policy is stdlib-read-only; per-app writes are disallowed.',
      );
    }
  }

  private enforceSize(yamlText: string): void {
    const size = Buffer.byteLength(yamlText, 'utf8');
    if (size > METHODOLOGY_SIZE_CAP_BYTES) {
      throw new CortexMethodologyError(
        'METHODOLOGY_TOO_LARGE',
        `Methodology YAML exceeds ${METHODOLOGY_SIZE_CAP_BYTES}-byte soft cap (${size} bytes).`,
        { details: { size, cap: METHODOLOGY_SIZE_CAP_BYTES } },
      );
    }
  }

  private notify(change: MethodologyChange): void {
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (err) {
        this.logger.error?.(
          `[methodology-source] listener error: ${(err as Error).message}`,
        );
      }
    }
  }
}

// ── Version helpers ───────────────────────────────────────────────

/**
 * Semver-ish bump: increments the last numeric dotted segment. Falls back to
 * timestamp-based version if the previous version is non-semver.
 */
function bumpVersion(previous: string | undefined): string {
  if (!previous) return '1.0.0';
  const parts = previous.split('.');
  const tail = parts[parts.length - 1];
  const n = Number(tail);
  if (Number.isFinite(n) && !Number.isNaN(n)) {
    parts[parts.length - 1] = String(n + 1);
    return parts.join('.');
  }
  return `${previous}-${Date.now()}`;
}

function stdlibStubYaml(entry: CatalogMethodologyEntry): string {
  // Minimal round-trippable stub — the admin may overwrite via upsert.
  return [
    'methodology:',
    `  id: ${entry.methodologyId}`,
    `  name: ${JSON.stringify(entry.name)}`,
    `  description: ${JSON.stringify(entry.description)}`,
    `  version: "${entry.version}"`,
    'transition_function:',
    '  arms: []',
    '',
  ].join('\n');
}

// ── Re-export helpers used in tests ───────────────────────────────

export type { CacheEntry };
