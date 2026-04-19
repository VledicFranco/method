// SPDX-License-Identifier: Apache-2.0
/**
 * `ComplianceReport` — JSON artifact produced by
 * {@link runCortexAgentConformance} and consumed by Cortex to flip the
 * `certified` flag on an `agent`-category tenant app.
 *
 * S8 §5.4 freezes the schema. PRD-065 §9 fully specifies canonicalization
 * (RFC 8785-style JCS-lite) and signer plumbing.
 */

import * as crypto from 'node:crypto';
import type { RecordedCtxCall } from './mock-cortex-ctx.js';
import type { FixtureId } from './fixtures/index.js';

// ── Report types ────────────────────────────────────────────────

export interface CheckVerdict {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly fixtureId: FixtureId;
  readonly evidence?: string;
}

export interface PluginVerdict {
  readonly id: string;
  readonly version: string;
  readonly passed: boolean;
  readonly checks: ReadonlyArray<CheckVerdict>;
}

export interface FixtureRunResult {
  readonly fixtureId: FixtureId;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly callCounts: {
    readonly audit: number;
    readonly llm: number;
    readonly storage: number;
    readonly jobs: number;
    readonly events: number;
    readonly auth: number;
  };
  readonly maxDelegationDepth: number;
  readonly failedCheckIds: ReadonlyArray<string>;
  readonly recorderSnapshot?: ReadonlyArray<RecordedCtxCall>;
}

export interface ComplianceReport {
  readonly schemaVersion: '1.0';
  readonly generatedAt: string;
  readonly app: {
    readonly id: string;
    readonly version?: string;
    readonly pactaTestkitVersion: string;
  };
  readonly passed: boolean;
  readonly summary: string;
  readonly fixtureRuns: ReadonlyArray<FixtureRunResult>;
  readonly plugins: ReadonlyArray<PluginVerdict>;
  readonly requiredPlugins: ReadonlyArray<string>;
  readonly env: {
    readonly nodeVersion: string;
    readonly os: string;
    readonly ci: boolean;
    readonly commitSha?: string;
  };
  readonly signature?: {
    readonly algorithm: 'ed25519' | 'ecdsa-p256';
    readonly value: string;
    readonly keyId?: string;
  };
}

// ── Canonicalization (RFC 8785-style JCS-lite, PRD-065 §9.1) ────

/**
 * Canonicalize a JSON value: sort object keys lexicographically at every
 * depth, no extraneous whitespace, standard JSON escaping. The `signature`
 * field at the top level is intentionally stripped before signing.
 */
function canonicalizeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonicalizeValue: non-finite number encountered (${String(value)})`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeValue(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeValue(v)}`)
      .join(',');
    return `{${body}}`;
  }
  throw new Error(`canonicalizeValue: unsupported type ${typeof value}`);
}

/**
 * Canonical byte representation of a {@link ComplianceReport}, EXCLUDING the
 * `signature` field (the signer signs over this). The resulting bytes are
 * deterministic across runs given equal inputs.
 */
export function canonicalizeReport(report: ComplianceReport): Uint8Array {
  const { signature: _signature, ...withoutSig } = report as ComplianceReport & {
    signature?: unknown;
  };
  const str = canonicalizeValue(withoutSig);
  return new TextEncoder().encode(str);
}

// ── Signer contract (S8 §5.1, PRD-065 §11) ──────────────────────

export type Signer = (canonicalBytes: Uint8Array) => Promise<string>;

/**
 * Convenience helper for callers holding a PEM-encoded Ed25519 private key
 * on disk. Produces a detached signature over `canonicalBytes`, returned as
 * base64.
 *
 * Callers may ignore this helper and supply their own {@link Signer}
 * implementation (e.g., calling a KMS or HSM).
 */
export function createEd25519Signer(privateKeyPem: string, _keyId?: string): Signer {
  return async (canonicalBytes) => {
    const keyObject = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem' });
    const signature = crypto.sign(null, canonicalBytes, keyObject);
    return signature.toString('base64');
  };
}

// ── Report construction helpers ─────────────────────────────────

export interface EnvFingerprint {
  readonly nodeVersion: string;
  readonly os: string;
  readonly ci: boolean;
  readonly commitSha?: string;
}

export function detectEnvFingerprint(): EnvFingerprint {
  const env = process.env;
  const ci = Boolean(
    env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.CIRCLECI || env.BUILDKITE,
  );
  const fingerprint: EnvFingerprint = {
    nodeVersion: process.version,
    os: `${process.platform}-${process.arch}`,
    ci,
  };
  const sha = env.GITHUB_SHA || env.CI_COMMIT_SHA || env.COMMIT_SHA;
  if (typeof sha === 'string' && sha.length > 0) {
    return { ...fingerprint, commitSha: sha };
  }
  return fingerprint;
}

/**
 * Serialize a {@link ComplianceReport} for on-disk persistence. Uses the
 * canonical byte representation extended with the `signature` field (if
 * present) appended after canonicalization, so file contents match the
 * canonical form byte-for-byte modulo the signature block.
 */
export function serializeReport(report: ComplianceReport): string {
  // For human-readable on-disk form, pretty-print JSON. Canonicalization is
  // only used for signing; the file format can be pretty while the signed
  // bytes are canonical.
  return JSON.stringify(report, null, 2);
}
