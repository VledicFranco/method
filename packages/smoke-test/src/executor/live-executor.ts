// SPDX-License-Identifier: Apache-2.0
/**
 * Live executor — wires real Anthropic provider into DagStrategyExecutor.
 *
 * Only used when ANTHROPIC_API_KEY is available. Runs strategy fixtures
 * against real Claude API for human verification of end-to-end behavior.
 */

import type { AgentProvider } from '@methodts/pacta';
import { anthropicProvider } from '@methodts/pacta-provider-anthropic';

/**
 * Check if live mode is available (API key present).
 */
export function isLiveModeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Create a real Anthropic provider for live smoke tests.
 * Defaults to claude-sonnet-4-6 for reasonable cost/quality.
 */
export function createLiveProvider(
  model?: string,
): AgentProvider {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY required for live mode');
  }
  return anthropicProvider({
    model: model ?? 'claude-sonnet-4-6',
  });
}
