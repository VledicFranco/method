/**
 * Scope Contract — capability constraints for agent invocations.
 *
 * Defines what the agent is allowed to do: which tools, which
 * filesystem paths, which model, and how permissions are handled.
 */

export interface ScopeContract {
  /** Tools the agent may use (whitelist — if set, only these are available) */
  allowedTools?: string[];

  /** Tools the agent must not use (blacklist — applied after whitelist) */
  deniedTools?: string[];

  /** Filesystem paths the agent may access (glob patterns) */
  allowedPaths?: string[];

  /** Model constraint (e.g., 'claude-sonnet-4-6', 'claude-haiku-4-5') */
  model?: string;

  /** How tool permission prompts are handled */
  permissionMode?: 'ask' | 'auto' | 'deny';
}
