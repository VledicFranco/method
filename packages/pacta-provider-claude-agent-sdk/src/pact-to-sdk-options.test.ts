// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for `pactToSdkOptions` — the cost-defaults choke point.
 *
 * Critical assertions (per realize-plan C-1 deliverables §6):
 *   - tools=[] by default (G-COST)
 *   - settingSources=[] by default (G-COST)
 *   - agents={} by default (G-COST)
 *   - env does NOT contain CLAUDE_CONFIG_DIR or ANTHROPIC_BASE_URL
 *     unless the transport supplied them
 *   - tenant pact.scope.allowedTools narrows the tools list
 *   - pact.scope.model overrides default model
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pact, AgentRequest } from '@methodts/pacta';
import { pactToSdkOptions } from './pact-to-sdk-options.js';

// ── Fixtures ─────────────────────────────────────────────────────

const minimalPact: Pact = {
  mode: { type: 'oneshot' },
};

const minimalRequest: AgentRequest = {
  prompt: 'Hello',
};

function build(overrides: Partial<Parameters<typeof pactToSdkOptions>[0]> = {}) {
  return pactToSdkOptions({
    pact: minimalPact,
    request: minimalRequest,
    config: {},
    transportEnv: { ANTHROPIC_API_KEY: 'test-key' },
    ...overrides,
  });
}

// ── G-COST defaults ──────────────────────────────────────────────

describe('pactToSdkOptions — G-COST cost-suppression defaults', () => {
  it('defaults `tools` to empty array (suppresses ~80 KB built-in tools)', () => {
    const { options } = build();
    assert.deepEqual(options.tools, [], 'tools must default to []');
  });

  it('defaults `settingSources` to empty array (suppresses ~76 KB filesystem settings)', () => {
    const { options } = build();
    assert.deepEqual(
      options.settingSources,
      [],
      'settingSources must be EXPLICITLY [] — omitting is not the same per spike-2',
    );
  });

  it('defaults `agents` to empty object (suppresses sub-agent definitions)', () => {
    const { options } = build();
    assert.deepEqual(options.agents, {}, 'agents must default to {}');
  });

  it('overrides systemPrompt to a minimal string when request supplies none', () => {
    const { options } = build();
    assert.equal(typeof options.systemPrompt, 'string');
    assert.ok(
      typeof options.systemPrompt === 'string' && options.systemPrompt.length < 200,
      'default system prompt must be short — protects per-request body size',
    );
  });
});

// ── Env sanitization ─────────────────────────────────────────────

describe('pactToSdkOptions — env sanitization', () => {
  it('does NOT include CLAUDE_CONFIG_DIR when transport does not supply it', () => {
    // Force CLAUDE_CONFIG_DIR into the parent env, then check it is
    // stripped from the SDK options.
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/leaked';
    try {
      const { options } = build();
      assert.ok(options.env, 'env must be set');
      assert.ok(
        !('CLAUDE_CONFIG_DIR' in (options.env ?? {})),
        'CLAUDE_CONFIG_DIR must be sanitized out — would re-attach cached MCP auth',
      );
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });

  it('does NOT include ANTHROPIC_BASE_URL when transport does not supply it', () => {
    const original = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'http://leaked';
    try {
      const { options } = build();
      assert.ok(
        !('ANTHROPIC_BASE_URL' in (options.env ?? {})),
        'ANTHROPIC_BASE_URL must come from the transport, not the parent env',
      );
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = original;
    }
  });

  it('does include ANTHROPIC_BASE_URL when transport supplies it', () => {
    const { options } = build({
      transportEnv: {
        ANTHROPIC_API_KEY: 'k',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999',
      },
    });
    assert.equal(options.env?.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9999');
  });

  it('always includes the transport-supplied ANTHROPIC_API_KEY', () => {
    const { options } = build({
      transportEnv: { ANTHROPIC_API_KEY: 'sk-test' },
    });
    assert.equal(options.env?.ANTHROPIC_API_KEY, 'sk-test');
  });
});

// ── Tenant overrides ─────────────────────────────────────────────

describe('pactToSdkOptions — tenant overrides', () => {
  it('narrows tools when pact.scope.allowedTools is set', () => {
    const { options } = build({
      pact: {
        ...minimalPact,
        scope: { allowedTools: ['Read', 'Grep'] },
      },
    });
    assert.deepEqual(options.tools, ['Read', 'Grep']);
  });

  it('keeps tools=[] when pact.scope.allowedTools is empty array', () => {
    const { options } = build({
      pact: {
        ...minimalPact,
        scope: { allowedTools: [] },
      },
    });
    assert.deepEqual(options.tools, [], 'empty whitelist is the same as no tools');
  });

  it('uses pact.scope.model when set', () => {
    const { model, options } = build({
      pact: {
        ...minimalPact,
        scope: { model: 'claude-haiku-4-5' },
      },
    });
    assert.equal(model, 'claude-haiku-4-5');
    assert.equal(options.model, 'claude-haiku-4-5');
  });

  it('falls back to config.defaultModel when pact has no model', () => {
    const { model } = build({
      config: { defaultModel: 'claude-opus-4-7' },
    });
    assert.equal(model, 'claude-opus-4-7');
  });

  it('falls back to a built-in default when neither pact nor config sets a model', () => {
    const { model } = build();
    assert.equal(model, 'claude-sonnet-4-6');
  });

  it('uses pact.budget.maxTurns when set', () => {
    const { options } = build({
      pact: {
        ...minimalPact,
        budget: { maxTurns: 7 },
      },
    });
    assert.equal(options.maxTurns, 7);
  });

  it('uses request.systemPrompt when supplied', () => {
    const { options } = build({
      request: {
        prompt: 'go',
        systemPrompt: 'You are a careful auditor.',
      },
    });
    assert.equal(options.systemPrompt, 'You are a careful auditor.');
  });
});

// ── AC-1.3: per-request body ceiling ─────────────────────────────

describe('pactToSdkOptions — per-request body ceiling (AC-1.3)', () => {
  it('options object serializes to ≤ 12 KB excluding tenant content', () => {
    // The PRD ceiling is 12 KB excluding tenant-supplied tools/messages.
    // Our minimal pact has no tenant tools and a short prompt; the
    // serialized options should be well under the ceiling.
    const { options } = build();
    // Strip the abortController (non-serializable) before measuring.
    const { abortController, ...measurable } = options;
    void abortController;
    const json = JSON.stringify(measurable);
    const bytes = Buffer.byteLength(json, 'utf-8');
    assert.ok(
      bytes <= 12 * 1024,
      `serialized SDK options were ${bytes} bytes; ceiling is 12 KB`,
    );
  });
});
