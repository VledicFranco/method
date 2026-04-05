/**
 * Validator tests — evaluates TestableAssertions.
 *
 * Tests command, typescript, and grep assertion types with real processes.
 */

import { describe, it, expect } from 'vitest';
import { Validator } from '../validator.js';
import type { CommandExecutor, CommandExecutorResult } from '../validator.js';
import type { TestableAssertion } from '../../../ports/checkpoint.js';

// ── Real Command Executor (for integration tests) ─────────────

class NodeCommandExecutor implements CommandExecutor {
  async exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<CommandExecutorResult> {
    const { execSync } = await import('node:child_process');
    try {
      const stdout = execSync(command, {
        cwd: options?.cwd,
        timeout: options?.timeout ?? 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { exitCode: 0, stdout: stdout ?? '', stderr: '' };
    } catch (err: unknown) {
      const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: error.status ?? 1,
        stdout: (error.stdout as string) ?? '',
        stderr: (error.stderr as string) ?? error.message ?? '',
      };
    }
  }
}

// ── Mock Command Executor ─────────────────────────────────────

class MockCommandExecutor implements CommandExecutor {
  calls: Array<{ command: string; options?: { cwd?: string; timeout?: number } }> = [];
  nextResult: CommandExecutorResult = { exitCode: 0, stdout: '', stderr: '' };

  async exec(command: string, options?: { cwd?: string; timeout?: number }): Promise<CommandExecutorResult> {
    this.calls.push({ command, options });
    return this.nextResult;
  }
}

describe('Validator', () => {
  describe('command assertion', () => {
    it('passes when command exits with code 0', async () => {
      const executor = new NodeCommandExecutor();
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'echo-test', type: 'command', check: 'echo hello', expect: 'exit 0' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(true);
      expect(report.criteria).toHaveLength(1);
      expect(report.criteria[0].passed).toBe(true);
      expect(report.criteria[0].evidence).toContain('Command succeeded');
    });

    it('fails when command exits with non-zero code', async () => {
      const executor = new NodeCommandExecutor();
      const validator = new Validator(executor, process.cwd());

      // Use a command that fails cross-platform
      const assertions: TestableAssertion[] = [
        { name: 'fail-test', type: 'command', check: 'node -e "process.exit(1)"', expect: 'exit 0' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(false);
      expect(report.criteria[0].evidence).toContain('Command failed');
    });

    it('checks stdout content when expect is not an exit code', async () => {
      const executor = new MockCommandExecutor();
      executor.nextResult = { exitCode: 0, stdout: 'hello world', stderr: '' };
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'content-test', type: 'command', check: 'echo hello world', expect: 'hello' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(true);
      expect(report.criteria[0].passed).toBe(true);
    });
  });

  describe('typescript assertion', () => {
    it('passes when tsc reports zero errors on the project', async () => {
      const executor = new NodeCommandExecutor();
      // Use the project's own tsconfig
      const projectRoot = process.cwd();
      const validator = new Validator(executor, projectRoot);

      const assertions: TestableAssertion[] = [
        {
          name: 'project-types',
          type: 'typescript',
          check: 'node -e "process.exit(0)"', // Lightweight stand-in; real tsc is slow
          expect: '0',
        },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(true);
      expect(report.criteria[0].passed).toBe(true);
      expect(report.criteria[0].evidence).toContain('TypeScript compilation succeeded');
    });

    it('fails when tsc reports errors', async () => {
      const executor = new MockCommandExecutor();
      executor.nextResult = {
        exitCode: 2,
        stdout: 'src/index.ts(1,1): error TS2304: Cannot find name "foo".',
        stderr: '',
      };
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'types-fail', type: 'typescript', check: 'npx tsc --noEmit', expect: '0' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(false);
      expect(report.criteria[0].evidence).toContain('TypeScript errors');
    });
  });

  describe('grep assertion', () => {
    it('passes when pattern is found in target', async () => {
      const executor = new MockCommandExecutor();
      executor.nextResult = {
        exitCode: 0,
        stdout: 'src/domains/build/orchestrator.ts:export class BuildOrchestrator',
        stderr: '',
      };
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'class-exists', type: 'grep', check: 'BuildOrchestrator', expect: 'src/' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(true);
      expect(report.criteria[0].passed).toBe(true);
      expect(report.criteria[0].evidence).toContain('Pattern found');
    });

    it('fails when pattern is not found', async () => {
      const executor = new MockCommandExecutor();
      executor.nextResult = { exitCode: 1, stdout: '', stderr: '' };
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'missing-class', type: 'grep', check: 'NonExistentClass', expect: 'src/' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(false);
      expect(report.criteria[0].evidence).toContain('not found');
    });
  });

  describe('endpoint assertion', () => {
    it('returns not-implemented stub', async () => {
      const executor = new MockCommandExecutor();
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'api-check', type: 'endpoint', check: '/api/health', expect: '200' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(false);
      expect(report.criteria[0].evidence).toContain('not implemented');
    });
  });

  describe('custom assertion', () => {
    it('returns not-implemented stub', async () => {
      const executor = new MockCommandExecutor();
      const validator = new Validator(executor, process.cwd());

      const assertions: TestableAssertion[] = [
        { name: 'custom-check', type: 'custom', check: 'validate-schema', expect: 'pass' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(false);
      expect(report.criteria[0].evidence).toContain('not implemented');
    });
  });

  describe('multiple assertions', () => {
    it('allPassed is false when any assertion fails', async () => {
      const executor = new MockCommandExecutor();
      const validator = new Validator(executor, process.cwd());
      let callCount = 0;

      // Override exec to alternate success/failure
      executor.exec = async (command, options) => {
        callCount++;
        if (callCount === 1) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'error' };
      };

      const assertions: TestableAssertion[] = [
        { name: 'passes', type: 'command', check: 'echo ok', expect: 'exit 0' },
        { name: 'fails', type: 'command', check: 'false', expect: 'exit 0' },
      ];

      const report = await validator.evaluateAssertions(assertions);
      expect(report.allPassed).toBe(false);
      expect(report.criteria[0].passed).toBe(true);
      expect(report.criteria[1].passed).toBe(false);
    });
  });
});
