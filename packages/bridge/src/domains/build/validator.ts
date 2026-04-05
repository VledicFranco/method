/**
 * Validator — evaluates TestableAssertions for Phase 7 (validate).
 *
 * Each assertion type has a dedicated evaluator:
 * - command: spawn child process, check exit code, capture stdout
 * - typescript: run `npx tsc --noEmit`, check zero errors
 * - grep: search files for pattern
 * - endpoint: stub (Wave 2)
 * - custom: stub (Wave 2)
 *
 * Uses CommandExecutor port for process spawning per FCA G-PORT.
 *
 * @see PRD 047 — Build Orchestrator §Validator
 */

import type { TestableAssertion } from '../../ports/checkpoint.js';
import type { ValidationReport, CriterionResult } from './types.js';

// ── Command Executor Port ──────────────────────────────────────

export interface CommandExecutorResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Port for spawning child processes — injected to keep domain code clean of child_process. */
export interface CommandExecutor {
  exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<CommandExecutorResult>;
}

// ── Validator ──────────────────────────────────────────────────

export class Validator {
  constructor(
    private readonly executor: CommandExecutor,
    private readonly projectRoot: string,
  ) {}

  async evaluateAssertions(assertions: readonly TestableAssertion[]): Promise<ValidationReport> {
    const criteria: CriterionResult[] = [];

    for (const assertion of assertions) {
      const result = await this.evaluateOne(assertion);
      criteria.push(result);
    }

    return {
      criteria,
      allPassed: criteria.every(c => c.passed),
    };
  }

  private async evaluateOne(assertion: TestableAssertion): Promise<CriterionResult> {
    switch (assertion.type) {
      case 'command':
        return this.evaluateCommand(assertion);
      case 'typescript':
        return this.evaluateTypescript(assertion);
      case 'grep':
        return this.evaluateGrep(assertion);
      case 'endpoint':
        return this.evaluateEndpoint(assertion);
      case 'custom':
        return this.evaluateCustom(assertion);
      default:
        return {
          name: assertion.name,
          type: assertion.type,
          passed: false,
          evidence: `Unknown assertion type: ${assertion.type}`,
        };
    }
  }

  private async evaluateCommand(assertion: TestableAssertion): Promise<CriterionResult> {
    try {
      const result = await this.executor.exec(assertion.check, {
        cwd: this.projectRoot,
        timeout: 60_000,
      });

      const expectedExitCode = assertion.expect === 'exit 0' || assertion.expect === '0' ? 0 : parseInt(assertion.expect, 10);
      const passed = isNaN(expectedExitCode)
        ? result.stdout.includes(assertion.expect)
        : result.exitCode === expectedExitCode;

      return {
        name: assertion.name,
        type: 'command',
        passed,
        evidence: passed
          ? `Command succeeded (exit ${result.exitCode}): ${result.stdout.slice(0, 500)}`
          : `Command failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 500)}`,
      };
    } catch (err) {
      return {
        name: assertion.name,
        type: 'command',
        passed: false,
        evidence: `Command execution error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async evaluateTypescript(assertion: TestableAssertion): Promise<CriterionResult> {
    try {
      const cmd = assertion.check || 'npx tsc --noEmit';
      const result = await this.executor.exec(cmd, {
        cwd: this.projectRoot,
        timeout: 120_000,
      });

      const passed = result.exitCode === 0;

      return {
        name: assertion.name,
        type: 'typescript',
        passed,
        evidence: passed
          ? 'TypeScript compilation succeeded with zero errors'
          : `TypeScript errors:\n${(result.stdout + '\n' + result.stderr).slice(0, 1000)}`,
      };
    } catch (err) {
      return {
        name: assertion.name,
        type: 'typescript',
        passed: false,
        evidence: `TypeScript check error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async evaluateGrep(assertion: TestableAssertion): Promise<CriterionResult> {
    try {
      // assertion.check is the grep pattern, assertion.expect contains the file/dir to search
      const target = assertion.expect || '.';
      const cmd = process.platform === 'win32'
        ? `findstr /s /r "${assertion.check}" ${target}`
        : `grep -r "${assertion.check}" ${target}`;
      const result = await this.executor.exec(cmd, {
        cwd: this.projectRoot,
        timeout: 30_000,
      });

      const found = result.exitCode === 0;

      return {
        name: assertion.name,
        type: 'grep',
        passed: found,
        evidence: found
          ? `Pattern found: ${result.stdout.slice(0, 500)}`
          : `Pattern "${assertion.check}" not found in ${target}`,
      };
    } catch (err) {
      return {
        name: assertion.name,
        type: 'grep',
        passed: false,
        evidence: `Grep error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async evaluateEndpoint(_assertion: TestableAssertion): Promise<CriterionResult> {
    return {
      name: _assertion.name,
      type: 'endpoint',
      passed: false,
      evidence: 'Endpoint validation not implemented (Wave 2)',
    };
  }

  private async evaluateCustom(_assertion: TestableAssertion): Promise<CriterionResult> {
    return {
      name: _assertion.name,
      type: 'custom',
      passed: false,
      evidence: 'Custom validation not implemented (Wave 2)',
    };
  }
}
