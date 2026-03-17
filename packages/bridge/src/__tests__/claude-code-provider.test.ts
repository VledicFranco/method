import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeProvider } from '../strategy/claude-code-provider.js';

// ── ClaudeCodeProvider Unit Tests (PRD 012 Phase 4) ──────────────

describe('ClaudeCodeProvider', () => {
  describe('buildArgs()', () => {
    it('builds basic args with --print, -p, prompt, --output-format, --session-id, --permission-mode', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'Hello world',
        sessionId: 'test-session-123',
        outputFormat: 'json',
      });

      assert.ok(args.includes('--print'));
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('Hello world'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('json'));
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('test-session-123'));
      assert.ok(args.includes('--permission-mode'));
      assert.ok(args.includes('bypassPermissions'));
    });

    it('uses --resume instead of --session-id when resumeSessionId is set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'Follow up',
        sessionId: 'session-1',
        resumeSessionId: 'session-1',
      });

      assert.ok(args.includes('--resume'));
      assert.ok(args.includes('session-1'));
      assert.ok(!args.includes('--session-id'));
    });

    it('includes --max-budget-usd when set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        maxBudgetUsd: 0.50,
      });

      assert.ok(args.includes('--max-budget-usd'));
      assert.ok(args.includes('0.5'));
    });

    it('includes --append-system-prompt when set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        appendSystemPrompt: 'You are a bridge agent.',
      });

      assert.ok(args.includes('--append-system-prompt'));
      assert.ok(args.includes('You are a bridge agent.'));
    });

    it('includes --model when set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        model: 'claude-sonnet-4-6',
      });

      assert.ok(args.includes('--model'));
      assert.ok(args.includes('claude-sonnet-4-6'));
    });

    it('includes --verbose when set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        verbose: true,
      });

      assert.ok(args.includes('--verbose'));
    });

    it('includes --include-partial-messages when set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        includePartialMessages: true,
      });

      assert.ok(args.includes('--include-partial-messages'));
    });

    it('includes both --verbose and --include-partial-messages when both set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        verbose: true,
        includePartialMessages: true,
      });

      assert.ok(args.includes('--verbose'));
      assert.ok(args.includes('--include-partial-messages'));
    });

    it('appends additionalFlags', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        additionalFlags: ['--add-dir', '/extra/path'],
      });

      assert.ok(args.includes('--add-dir'));
      assert.ok(args.includes('/extra/path'));
    });

    it('uses custom permission mode when specified', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        permissionMode: 'plan',
      });

      assert.ok(args.includes('--permission-mode'));
      assert.ok(args.includes('plan'));
      assert.ok(!args.includes('bypassPermissions'));
    });

    it('defaults to json output format when outputFormat is omitted', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      const fmtIndex = args.indexOf('--output-format');
      assert.ok(fmtIndex >= 0);
      assert.equal(args[fmtIndex + 1], 'json');
    });

    it('respects explicit output format override', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
        outputFormat: 'stream-json',
      });

      const fmtIndex = args.indexOf('--output-format');
      assert.ok(fmtIndex >= 0);
      assert.equal(args[fmtIndex + 1], 'stream-json');
    });

    it('places --print and -p before the prompt', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'my prompt text',
        sessionId: 's1',
      });

      const printIdx = args.indexOf('--print');
      const pIdx = args.indexOf('-p');
      const promptIdx = args.indexOf('my prompt text');

      assert.ok(printIdx >= 0);
      assert.ok(pIdx >= 0);
      assert.ok(promptIdx >= 0);
      assert.ok(printIdx < promptIdx, '--print should come before the prompt');
      assert.ok(pIdx < promptIdx, '-p should come before the prompt');
    });

    it('does not include --max-budget-usd when not set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      assert.ok(!args.includes('--max-budget-usd'));
    });

    it('does not include --model when not set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      assert.ok(!args.includes('--model'));
    });

    it('does not include --verbose when not set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      assert.ok(!args.includes('--verbose'));
    });

    it('does not include --append-system-prompt when not set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      assert.ok(!args.includes('--append-system-prompt'));
    });

    it('does not include --include-partial-messages when not set', () => {
      const provider = new ClaudeCodeProvider('claude');
      const args = provider.buildArgs({
        prompt: 'test',
        sessionId: 's1',
      });

      assert.ok(!args.includes('--include-partial-messages'));
    });
  });
});
