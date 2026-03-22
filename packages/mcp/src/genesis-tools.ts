/**
 * PRD 020 Phase 2A: Genesis MCP Tool Wrappers
 *
 * MCP wrappers that enforce:
 * - Session isolation (Genesis session has project_id="root")
 * - Privilege enforcement for genesis_report (403 on non-root sessions)
 * - Input validation and error handling
 *
 * Exposes 5 tools:
 * - project_list()
 * - project_get(project_id)
 * - project_get_manifest(project_id)
 * - project_read_events(project_id?, since_cursor?)
 * - genesis_report(message) — Genesis (project_id="root") only
 */

import { z } from 'zod';

// Input schemas for validation
const projectIdInput = z.object({
  project_id: z.string().min(1).describe('Project ID'),
});

const projectReadEventsInput = z.object({
  project_id: z.string().optional().describe('Project ID to filter events'),
  since_cursor: z.string().optional().describe('Cursor from previous read'),
});

const genesisReportInput = z.object({
  message: z.string().min(1).describe('Message to report to human'),
});

/**
 * Session context for privilege enforcement
 */
export interface SessionContextForGenesis {
  project_id?: string;
  session_id?: string;
}

/**
 * Validate that a session is the Genesis session (project_id="root")
 * Throws 403 Forbidden if not
 */
export function enforceGenesisPrivilege(ctx: SessionContextForGenesis): void {
  if (ctx.project_id !== 'root') {
    const errorMsg =
      ctx.project_id
        ? `genesis_report is only available to Genesis session (root), not ${ctx.project_id}`
        : 'genesis_report requires Genesis session (project_id="root")';

    // In MCP tool handler, this should be caught and returned as HTTP 403
    const error = new Error(errorMsg);
    (error as any).statusCode = 403;
    throw error;
  }
}

/**
 * Tool handler definitions for MCP registration
 * These return the tool metadata for the ListToolsRequest
 */
export const genesisToolDefinitions = [
  {
    name: 'project_list',
    description:
      'List all discovered projects with metadata (id, name, description, installed_methodologies, status)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'project_get',
    description: 'Get detailed metadata for a single project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'project_get_manifest',
    description: 'Read manifest.yaml content from a project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'project_read_events',
    description:
      'Read project events with cursor-based pagination. Filter by project_id to read events for that project only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to filter events (optional)',
        },
        since_cursor: {
          type: 'string',
          description: 'Cursor from previous read to get new events only',
        },
      },
    },
  },
  {
    name: 'genesis_report',
    description:
      'Report findings to the human operator. SECURITY: Only callable by Genesis session (project_id="root"). Non-Genesis sessions will receive 403 Forbidden.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Report message',
        },
      },
      required: ['message'],
    },
  },
];

/**
 * Validate and dispatch a tool call
 * Returns tool response or throws error (with optional statusCode for HTTP mapping)
 */
export async function validateGenesisToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionCtx: SessionContextForGenesis,
): Promise<{
  toolName: string;
  isValid: boolean;
  error?: string;
  validatedInput?: any;
}> {
  try {
    let validated: any;

    switch (toolName) {
      case 'project_list':
        validated = {};
        break;

      case 'project_get':
      case 'project_get_manifest':
        validated = projectIdInput.parse(toolInput);
        break;

      case 'project_read_events':
        validated = projectReadEventsInput.parse(toolInput);
        break;

      case 'genesis_report':
        // Enforce privilege before validating input
        enforceGenesisPrivilege(sessionCtx);
        validated = genesisReportInput.parse(toolInput);
        break;

      default:
        return {
          toolName,
          isValid: false,
          error: `Unknown tool: ${toolName}`,
        };
    }

    return {
      toolName,
      isValid: true,
      validatedInput: validated,
    };
  } catch (err) {
    const error = err as any;
    const statusCode = error.statusCode;

    return {
      toolName,
      isValid: false,
      error: `Invalid input: ${error.message}`,
      ...( statusCode && { statusCode } ),
    };
  }
}
