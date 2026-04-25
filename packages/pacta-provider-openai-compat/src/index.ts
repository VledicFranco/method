// SPDX-License-Identifier: Apache-2.0
// @methodts/pacta-provider-openai-compat — OpenAI-compatible AgentProvider.
// Targets any /v1/chat/completions endpoint (OpenRouter, Together,
// Fireworks, Groq, Cerebras, vLLM, ...). Designed as the mid-tier in
// PRD 057's SLM → mid → frontier cascade.

export {
  OpenAICompatibleProvider,
  OpenAICompatibleApiError,
  OpenAICompatibleNetworkError,
} from './provider.js';

export type {
  OpenAICompatibleProviderOptions,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
  OpenAIChatChoice,
  OpenAIUsage,
} from './types.js';
