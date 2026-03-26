/**
 * PRD 028 C-5: ClaudeCodeProvider stub — kept only for server-entry.ts backward compat.
 *
 * This class is deprecated. server-entry.ts instantiates it and passes it to
 * createPool() (which still types llmProvider as LlmProvider on master) and
 * registerStrategyRoutes() (_provider?: unknown, ignored).
 * The orchestrator will remove this in the post-wave-3 server-entry.ts cleanup
 * once pool.ts migrates to AgentProvider (C-4).
 *
 * @deprecated Use @method/pacta-provider-claude-cli claudeCliProvider() instead.
 */
import type { LlmProvider, LlmRequest, LlmResponse, LlmStreamEvent } from '../../ports/llm-provider.js';

export class ClaudeCodeProvider implements LlmProvider {
  constructor(_claudeBin?: string) {}

  async invoke(_request: LlmRequest): Promise<LlmResponse> {
    throw new Error('ClaudeCodeProvider is deprecated — use claudeCliProvider() from @method/pacta-provider-claude-cli');
  }

  async invokeStreaming(
    _request: LlmRequest,
    _onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse> {
    throw new Error('ClaudeCodeProvider is deprecated — use claudeCliProvider() from @method/pacta-provider-claude-cli');
  }
}
