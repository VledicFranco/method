// @method/pacta-provider-ollama — Ollama AgentProvider (OpenAI-compatible)

// Provider factory
export { ollamaProvider, OllamaApiError } from './ollama-provider.js';
export type { OllamaProviderOptions, OllamaProvider } from './ollama-provider.js';

// Raw API types (for advanced usage / custom integrations)
export type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaChoice,
  OllamaUsage,
  OllamaTagsResponse,
  OllamaModelInfo,
  OllamaVersionResponse,
} from './types.js';
