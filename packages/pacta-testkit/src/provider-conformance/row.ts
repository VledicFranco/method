// SPDX-License-Identifier: Apache-2.0
/**
 * Provider Conformance Row — a reusable test scaffold for pacta
 * `AgentProvider` implementations.
 *
 * Each pacta provider (anthropic, claude-cli, claude-agent-sdk, ollama,
 * cortex) can register a row here to declare the invariants its
 * implementation upholds. The row is exercised by a generic runner
 * (`runProviderConformanceRow`) against whatever test runner the host
 * package uses (node:test, vitest, …).
 *
 * Scope — what a row MUST cover:
 *   1. `capabilities` — the provider reports a well-formed
 *      `ProviderCapabilities` shape with the claimed modes/streaming/
 *      budgetEnforcement/outputValidation/toolModel.
 *   2. `oneshot` — invoking the provider in oneshot mode (mock transport,
 *      no real subprocess / API call) returns an `AgentResult` with the
 *      required fields populated.
 *   3. `outputValidation` — the `AgentResult.output` is parseable by a
 *      caller-supplied `SchemaDefinition` (clients validate, so the row
 *      verifies the provider surfaces a value the client can validate).
 *
 * Non-goals:
 *   - Streaming, resumable, or killable surfaces — those live in
 *     separate capability-specific rows (added when the first provider
 *     needs them).
 *   - Real API calls — every row must be hermetic.
 */

import type {
  AgentProvider,
  AgentResult,
  ProviderCapabilities,
  SchemaDefinition,
} from '@methodts/pacta';

// ── Row shape ─────────────────────────────────────────────────────

/**
 * Per-row declaration. A pacta provider package owns its row and
 * registers it via its own test file — the registry lives alongside
 * the provider, not in a central file here, so each row versions with
 * the provider it covers.
 */
export interface ProviderConformanceRow<TOutput = string> {
  /** Human-readable id of the row — matches the provider package name. */
  readonly id: string;

  /**
   * Expected capabilities. The runner asserts `provider.capabilities()`
   * reports exactly these values. Narrower types than
   * `ProviderCapabilities` let a row express "this provider supports
   * exactly oneshot" without leaving other modes undeclared.
   */
  readonly expectedCapabilities: ProviderCapabilities;

  /** The provider under test — must not perform real I/O. */
  readonly makeProvider: () => AgentProvider | Promise<AgentProvider>;

  /**
   * Oneshot-mode invocation. The row supplies a mock-transport-backed
   * helper that drives the provider's result-assembly path without
   * spawning a subprocess or calling a live API. Returns the final
   * `AgentResult` the provider would have produced.
   *
   * For providers whose `invoke()` tightly couples to a subprocess
   * (claude-agent-sdk, claude-cli), this hook typically calls the
   * provider's exported stream-drain helper against scripted messages.
   */
  readonly runOneshot: () => Promise<AgentResult<TOutput>>;

  /**
   * Output validation — a schema the `AgentResult.output` must parse
   * against. Providers with `outputValidation: 'client'` only need to
   * surface the raw string; the schema here is supplied by the row.
   */
  readonly outputSchema: SchemaDefinition<TOutput>;
}

// ── Assertions ─────────────────────────────────────────────────────

export class ProviderConformanceError extends Error {
  constructor(
    public readonly rowId: string,
    public readonly check: string,
    message: string,
  ) {
    super(`[${rowId}] ${check}: ${message}`);
    this.name = 'ProviderConformanceError';
  }
}

function assertCapabilities(
  rowId: string,
  actual: ProviderCapabilities,
  expected: ProviderCapabilities,
): void {
  const mismatches: string[] = [];

  if (actual.modes.length !== expected.modes.length ||
      !actual.modes.every((m, i) => m === expected.modes[i])) {
    mismatches.push(
      `modes: expected [${expected.modes.join(', ')}], got [${actual.modes.join(', ')}]`,
    );
  }
  if (actual.streaming !== expected.streaming) {
    mismatches.push(`streaming: expected ${expected.streaming}, got ${actual.streaming}`);
  }
  if (actual.resumable !== expected.resumable) {
    mismatches.push(`resumable: expected ${expected.resumable}, got ${actual.resumable}`);
  }
  if (actual.budgetEnforcement !== expected.budgetEnforcement) {
    mismatches.push(
      `budgetEnforcement: expected ${expected.budgetEnforcement}, got ${actual.budgetEnforcement}`,
    );
  }
  if (actual.outputValidation !== expected.outputValidation) {
    mismatches.push(
      `outputValidation: expected ${expected.outputValidation}, got ${actual.outputValidation}`,
    );
  }
  if (actual.toolModel !== expected.toolModel) {
    mismatches.push(`toolModel: expected ${expected.toolModel}, got ${actual.toolModel}`);
  }

  if (mismatches.length > 0) {
    throw new ProviderConformanceError(rowId, 'capabilities', mismatches.join('; '));
  }
}

function assertOneshotResultShape<T>(rowId: string, result: AgentResult<T>): void {
  const issues: string[] = [];
  if (typeof result.completed !== 'boolean') issues.push('completed must be boolean');
  if (typeof result.sessionId !== 'string') issues.push('sessionId must be string');
  if (typeof result.stopReason !== 'string') issues.push('stopReason must be string');
  if (typeof result.turns !== 'number') issues.push('turns must be number');
  if (typeof result.durationMs !== 'number' || result.durationMs < 0) {
    issues.push('durationMs must be a non-negative number');
  }
  if (!result.usage || typeof result.usage.inputTokens !== 'number' ||
      typeof result.usage.outputTokens !== 'number' ||
      typeof result.usage.totalTokens !== 'number') {
    issues.push('usage must have inputTokens, outputTokens, totalTokens');
  }
  if (!result.cost || typeof result.cost.totalUsd !== 'number') {
    issues.push('cost.totalUsd must be a number');
  }
  if (issues.length > 0) {
    throw new ProviderConformanceError(rowId, 'oneshot', issues.join('; '));
  }
}

function assertOutputParses<T>(
  rowId: string,
  result: AgentResult<T>,
  schema: SchemaDefinition<T>,
): void {
  const parsed = schema.parse(result.output);
  if (!parsed.success) {
    throw new ProviderConformanceError(
      rowId,
      'outputValidation',
      `output did not parse: ${parsed.errors.join('; ')}`,
    );
  }
}

// ── Runner ─────────────────────────────────────────────────────────

export interface ProviderConformanceReport {
  readonly rowId: string;
  readonly passed: boolean;
  readonly checks: ReadonlyArray<{ name: string; passed: boolean; error?: string }>;
}

/**
 * Run a provider conformance row. Each check is isolated — a failure in
 * one check does not short-circuit the rest, so the returned report
 * surfaces every broken invariant.
 *
 * Throws only on infrastructure faults (e.g. `makeProvider` returned
 * `undefined`). Check failures are reported in `ProviderConformanceReport`
 * so the caller can assert-all via its own test runner.
 */
export async function runProviderConformanceRow<T = string>(
  row: ProviderConformanceRow<T>,
): Promise<ProviderConformanceReport> {
  const checks: { name: string; passed: boolean; error?: string }[] = [];

  // Check 1 — capabilities
  let provider: AgentProvider;
  try {
    provider = await row.makeProvider();
    if (!provider || typeof provider.capabilities !== 'function') {
      throw new ProviderConformanceError(
        row.id,
        'capabilities',
        'makeProvider did not return an AgentProvider',
      );
    }
    assertCapabilities(row.id, provider.capabilities(), row.expectedCapabilities);
    checks.push({ name: 'capabilities', passed: true });
  } catch (err) {
    checks.push({
      name: 'capabilities',
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    });
    // Without a provider we can't run further checks, but we still
    // report both remaining checks as failed so the caller sees a
    // full row result.
    checks.push({ name: 'oneshot', passed: false, error: 'skipped: capabilities check failed' });
    checks.push({ name: 'outputValidation', passed: false, error: 'skipped: capabilities check failed' });
    return { rowId: row.id, passed: false, checks };
  }

  // Check 2 — oneshot
  let oneshotResult: AgentResult<T> | undefined;
  try {
    oneshotResult = await row.runOneshot();
    assertOneshotResultShape(row.id, oneshotResult);
    checks.push({ name: 'oneshot', passed: true });
  } catch (err) {
    checks.push({
      name: 'oneshot',
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Check 3 — outputValidation
  if (!oneshotResult) {
    checks.push({
      name: 'outputValidation',
      passed: false,
      error: 'skipped: oneshot check did not produce a result',
    });
  } else {
    try {
      assertOutputParses(row.id, oneshotResult, row.outputSchema);
      checks.push({ name: 'outputValidation', passed: true });
    } catch (err) {
      checks.push({
        name: 'outputValidation',
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    rowId: row.id,
    passed: checks.every((c) => c.passed),
    checks,
  };
}
