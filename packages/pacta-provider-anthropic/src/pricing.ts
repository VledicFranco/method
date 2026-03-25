/**
 * Model Pricing — cost calculation for Anthropic models.
 *
 * Prices are per million tokens. Updated as of 2025-05.
 * Cache pricing follows Anthropic's prompt caching tiers.
 */

import type { TokenUsage, CostReport } from '@method/pacta';
import type { AnthropicUsage } from './types.js';

// ── Price Table ───────────────────────────────────────────────────

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-opus-4-20250514': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-haiku-4-5-20250514': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
};

// Fallback pricing for unknown models (use Sonnet pricing as default)
const DEFAULT_PRICING: ModelPricing = PRICING['claude-sonnet-4-6'];

// ── Public API ────────────────────────────────────────────────────

export function mapUsage(anthropicUsage: AnthropicUsage): TokenUsage {
  const inputTokens = anthropicUsage.input_tokens;
  const outputTokens = anthropicUsage.output_tokens;
  const cacheWriteTokens = anthropicUsage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = anthropicUsage.cache_read_input_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
  };
}

export function calculateCost(model: string, usage: TokenUsage): CostReport {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;

  const totalUsd = inputCost + outputCost + cacheWriteCost + cacheReadCost;

  return {
    totalUsd,
    perModel: {
      [model]: {
        tokens: usage,
        costUsd: totalUsd,
      },
    },
  };
}
