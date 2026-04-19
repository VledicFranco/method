// SPDX-License-Identifier: Apache-2.0
/**
 * `@methodts/pacta-testkit/conformance` — Cortex Agent Conformance Testkit.
 *
 * Public surface frozen by S8 (`.method/sessions/fcd-surface-conformance-testkit/decision.md`).
 * Implements PRD-065.
 *
 * Entry point: {@link runCortexAgentConformance}. Called by a Cortex tenant
 * app's CI to produce a signed `ComplianceReport.json` that Cortex reads to
 * flip the app's `certified` flag.
 */

// ── Runner ──────────────────────────────────────────────────────
export {
  runCortexAgentConformance,
  validatePluginList,
  PACTA_TESTKIT_VERSION,
} from './conformance-runner.js';
export type { ConformanceOptions } from './conformance-runner.js';

// ── Errors ──────────────────────────────────────────────────────
export { ConformanceRunError } from './errors.js';
export type {
  ConformanceRunErrorCode,
  ConformanceRunErrorOptions,
} from './errors.js';

// ── Mock ctx + recorder ─────────────────────────────────────────
export { createMockCortexCtx } from './mock-cortex-ctx.js';
export type {
  MockCortexCtx,
  CallRecorder,
  RecordedCtxCall,
  ScriptedLlmResponse,
  ScriptedBudgetSignal,
  CreateMockCortexCtxOptions,
  TokenUsageShape,
} from './mock-cortex-ctx.js';

// ── Report types + signer plumbing ──────────────────────────────
export {
  canonicalizeReport,
  createEd25519Signer,
  detectEnvFingerprint,
  serializeReport,
} from './compliance-report.js';
export type {
  ComplianceReport,
  FixtureRunResult,
  PluginVerdict,
  CheckVerdict,
  Signer,
  EnvFingerprint,
} from './compliance-report.js';

// ── Plugin interface ────────────────────────────────────────────
export { DEFAULT_REQUIRED_PLUGIN_IDS } from './plugin.js';
export type { ConformancePlugin, PluginRunInput } from './plugin.js';

// ── Built-in plugins ────────────────────────────────────────────
export {
  s1MethodAgentPortPlugin,
  s3ServiceAdaptersPlugin,
  DEFAULT_PLUGINS,
} from './plugins/index.js';

// ── Fixtures (canonical catalog — also re-exported by ./fixtures) ──
export {
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
  DEFAULT_FIXTURES,
} from './fixtures/index.js';
export type {
  ConformanceFixture,
  FixtureId,
  FixtureExpectations,
} from './fixtures/index.js';

// ── Cortex type mirrors (structural — must stay in sync with @methodts/agent-runtime) ──
export type {
  CortexCtx,
  CortexAppFacade,
  CortexLlmFacade,
  CortexAuditFacade,
  CortexEventsFacade,
  CortexStorageFacade,
  CortexJobsFacade,
  CortexScheduleFacade,
  CortexAuthFacade,
  CortexLogger,
  MethodAgentResult,
} from './cortex-types.js';
