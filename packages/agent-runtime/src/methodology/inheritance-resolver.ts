/**
 * Inheritance resolution for CortexMethodologySource.
 *
 * Implements the three-mode algorithm in PRD-064 §6.3:
 *
 *   stdlib-plus-overrides : start from stdlib, per-app docs override by id
 *   per-app-only          : stdlib invisible; only per-app docs serve
 *   stdlib-read-only      : per-app invisible; fully delegates to stdlib
 *
 * Whole-document shadowing (no field-level merge in v1 per S7 §7.1).
 * `stdlib-pinned` docs are treated as no-op guards when the stdlib pin
 * matches the current stdlib version; a drift causes the pinned YAML to
 * become authoritative (the app froze its behavior).
 */

import type { MethodologySource } from '@method/runtime/ports';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import {
  loadMethodologyFromYamlString,
} from '@method/methodts';
import type { Method, Methodology } from '@method/methodts';
import type {
  MethodologyDocument,
  MethodologyPolicy,
  MethodologyInheritance,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethodology = Methodology<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethod = Method<any>;

/** Resolved per-methodology cache entry. */
export interface CacheEntry {
  readonly source: 'stdlib' | 'per-app' | 'pinned-current' | 'pinned-drifted';
  readonly version: string;
  readonly entry: CatalogMethodologyEntry;
  /** Present when the source is per-app / pinned (parsed from YAML). */
  readonly parsed?: AnyMethodology;
  /** Present only for per-app / pinned (we hold the raw doc for admin use). */
  readonly doc?: MethodologyDocument;
}

/** Input to the resolver. */
export interface ResolveInputs {
  readonly stdlib: MethodologySource;
  /** Stdlib version. Falls back to `"unknown"`. */
  readonly stdlibVersion: string;
  readonly policy: MethodologyPolicy;
  readonly perAppDocs: ReadonlyArray<MethodologyDocument>;
  readonly logger?: Pick<Console, 'warn' | 'error' | 'info'>;
}

/** Resolved cache + per-methodologyId Method lookup for `getMethod`. */
export interface ResolvedCache {
  readonly entries: Map<string, CacheEntry>;
  /** Per-app methodId lookup cache — populated lazily by the source. */
  readonly perAppMethods: Map<string, AnyMethod>;
}

export function resolveCache(inputs: ResolveInputs): ResolvedCache {
  const { stdlib, stdlibVersion, policy, perAppDocs, logger } = inputs;
  const entries = new Map<string, CacheEntry>();
  const perAppMethods = new Map<string, AnyMethod>();

  // ── Layer 1: stdlib base ───────────────────────────────────────
  if (policy.inheritance !== 'per-app-only') {
    for (const entry of stdlib.list()) {
      entries.set(entry.methodologyId, {
        source: 'stdlib',
        version: entry.version,
        entry,
      });
    }
  }

  // ── Layer 2: per-app docs ──────────────────────────────────────
  if (policy.inheritance !== 'stdlib-read-only') {
    for (const doc of perAppDocs) {
      let parsed: AnyMethodology;
      try {
        parsed = loadMethodologyFromYamlString(doc.yaml);
      } catch (err) {
        logger?.warn?.(
          `[methodology-source] failed to parse persisted doc ${doc.methodologyId}: ${(err as Error).message}`,
        );
        continue;
      }

      const entry: CatalogMethodologyEntry = {
        methodologyId: doc.methodologyId,
        name: doc.metadata.name,
        description: doc.metadata.description,
        version: doc.version,
        status: doc.status,
        methods: doc.metadata.methods.map(m => ({ ...m })),
      };

      if (doc.source === 'per-app') {
        entries.set(doc.methodologyId, {
          source: 'per-app',
          version: doc.version,
          entry,
          parsed,
          doc,
        });
      } else if (doc.source === 'stdlib-pinned') {
        const pinVersion = doc.parent?.stdlibVersion;
        if (pinVersion !== undefined && pinVersion !== stdlibVersion) {
          logger?.warn?.(
            `[methodology-source] stdlib pin drift on ${doc.methodologyId}: pinned ${pinVersion}, current ${stdlibVersion}`,
          );
          entries.set(doc.methodologyId, {
            source: 'pinned-drifted',
            version: doc.version,
            entry,
            parsed,
            doc,
          });
        } else {
          entries.set(doc.methodologyId, {
            source: 'pinned-current',
            version: doc.version,
            entry,
            parsed,
            doc,
          });
        }
      }
    }
  }

  // ── Layer 3: enabledMethodologies whitelist (final filter) ─────
  if (policy.enabledMethodologies != null) {
    const allowed = new Set(policy.enabledMethodologies);
    for (const id of [...entries.keys()]) {
      if (!allowed.has(id)) entries.delete(id);
    }
  }

  return { entries, perAppMethods };
}

/**
 * Promotion-only rule (PRD-064 §9.1). Allowed transitions:
 *
 *   stdlib-read-only      → stdlib-plus-overrides   (OK)
 *   anything-else         → anything-else (same)    (OK, idempotent)
 *   everything else — REJECTED.
 */
export function isPromotion(
  from: MethodologyInheritance,
  to: MethodologyInheritance,
): boolean {
  if (from === to) return true;
  if (from === 'stdlib-read-only' && to === 'stdlib-plus-overrides') return true;
  return false;
}
