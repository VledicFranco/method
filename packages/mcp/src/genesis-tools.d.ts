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
export declare function enforceGenesisPrivilege(ctx: SessionContextForGenesis): void;
/**
 * Tool handler definitions for MCP registration
 * These return the tool metadata for the ListToolsRequest
 */
export declare const genesisToolDefinitions: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            project_id?: undefined;
            since_cursor?: undefined;
            message?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            project_id: {
                type: string;
                description: string;
            };
            since_cursor?: undefined;
            message?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            project_id: {
                type: string;
                description: string;
            };
            since_cursor: {
                type: string;
                description: string;
            };
            message?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            message: {
                type: string;
                description: string;
            };
            project_id?: undefined;
            since_cursor?: undefined;
        };
        required: string[];
    };
})[];
/**
 * Validate and dispatch a tool call
 * Returns tool response or throws error (with optional statusCode for HTTP mapping)
 */
export declare function validateGenesisToolInput(toolName: string, toolInput: Record<string, unknown>, sessionCtx: SessionContextForGenesis): Promise<{
    toolName: string;
    isValid: boolean;
    error?: string;
    validatedInput?: any;
}>;
//# sourceMappingURL=genesis-tools.d.ts.map