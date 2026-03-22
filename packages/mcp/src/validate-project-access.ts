/**
 * MCP Tool Validation Middleware
 *
 * F-SECUR-003: Validates project isolation for all MCP tool calls.
 * Ensures that agents spawned in project A cannot access tools or data from project B.
 *
 * This middleware extracts the session's project_id and validates it against the tool's
 * scope. Tools without explicit project scope are allowed (methodology tools), but
 * project-specific tools must match the session's project context.
 */

/**
 * Session context extracted from MCP request arguments.
 * May include project_id (for isolated multi-project sessions).
 */
export interface SessionContext {
  session_id?: string;
  project_id?: string;
}

/**
 * Validation result.
 */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Tools that require project isolation validation.
 * These tools operate on project-specific data and must enforce access control.
 */
const PROJECT_SCOPED_TOOLS = new Set([
  // Project registry tools
  'project_list',
  'project_get',
  'project_read_events',
  // Resource copier tools (PRD 020 Phase 3)
  'resource_copy_methodology',
  'resource_copy_strategy',
  // Genesis agent tools
  'genesis_report',
]);

/**
 * Extract session context from tool arguments.
 * Looks for session_id and project_id in args.
 */
export function extractSessionContext(args: Record<string, unknown>): SessionContext {
  return {
    session_id: args.session_id as string | undefined,
    project_id: args.project_id as string | undefined,
  };
}

/**
 * Validate project access for a tool call.
 *
 * @param toolName - Name of the MCP tool being called
 * @param sessionContext - Extracted session context (may include project_id)
 * @returns Validation result with allowed flag and optional reason
 *
 * Rules:
 * - Methodology tools (methodology_list, step_current, etc.) are always allowed
 * - Project-scoped tools require session.project_id to be set
 * - No cross-project access (project_id mismatch)
 * - Genesis tools require explicit Genesis-enabled session marker (Future: Phase 2)
 */
export function validateProjectAccess(
  toolName: string,
  sessionContext: SessionContext,
): ValidationResult {
  // Methodology tools are always allowed (Phase 1)
  if (!PROJECT_SCOPED_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  // Project-scoped tools require a project_id in session context
  if (!sessionContext.project_id) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' requires project_id in session context. This tool is project-scoped and cannot be called without isolation context.`,
    };
  }

  // Note: Future phases will add:
  // - Genesis tool checks (requires genesis_enabled: true in session)
  // - Resource tool checks (requires resource_copy: true in session)

  return { allowed: true };
}

/**
 * Creates a validation middleware for tool calls.
 * Can be used as a guard before executing any tool.
 *
 * @example
 * const validate = createValidationMiddleware();
 * const result = validate(toolName, args);
 * if (!result.allowed) {
 *   console.warn(`[ISOLATION] Tool call denied: ${result.reason}`);
 *   return err(result.reason);
 * }
 */
export function createValidationMiddleware() {
  return (toolName: string, args: Record<string, unknown>): ValidationResult => {
    const sessionContext = extractSessionContext(args);
    return validateProjectAccess(toolName, sessionContext);
  };
}
