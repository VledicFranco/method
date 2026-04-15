/**
 * @method/mcp — Pure methodts → Cortex mapping (PRD-066 Track A, S9 §4.3).
 *
 * `methodtsToCortex()` turns a loaded methodology's Hoare-typed `Tool<S>`
 * set (plus role authorizations) into a Cortex `ToolRegistrationPayload`.
 *
 * **Purity contract:** no I/O, no network, no randomness. Deterministic
 * output given deterministic input. This is the specification — gate
 * G-MAP asserts output uniqueness against a fixture.
 *
 * **Mapping table (source-of-truth: S9 §4.3 / PRD-066 §7.2):**
 *
 *  - `Methodology.id`                -> ToolDescriptor.name prefix `method.<methodologyId>.<toolId>`
 *  - `Tool.id`                       -> ToolDescriptor.name suffix (1:1 after `:` → `.` sanitization)
 *  - `Tool.name`                     -> ToolDescriptor.displayName (when present)
 *  - `Tool.description`              -> ToolDescriptor.description AND OperationDef.description (single source)
 *  - `Tool.category='write'|'execute'` -> OperationDef.write = true  (observable side effects)
 *  - `Tool.category='read'|'communicate'` -> OperationDef.write = false
 *  - `Tool.precondition/postcondition` -> NOT MAPPED (Cortex authz is state-free)
 *  - `Step.tools[]`                  -> NOT MAPPED (step-level gating stays inside methodts)
 *  - role → authorizedToolIds        -> `suggestedPolicy[]` (sidecar; admin owns approval)
 *  - `OperationDef.transport`        -> always `"mcp-tool"` (web/http would be a separate surface)
 *  - `OperationDef.name`             -> identical to ToolDescriptor.name (1 operation per tool)
 *  - `inputSchema`/`outputSchema`    -> emitted verbatim when present; `{ type: 'object' }` + warn otherwise
 *
 * Side-effect flag rule: `write === true` for `"write"` and `"execute"`
 * categories (both mutate observable state). `"read"` and `"communicate"`
 * produce `write === false` (reads cacheable; `communicate` is write-free
 * in Cortex's sense — no platform state change).
 */

import type { Tool } from "@method/methodts";
import type {
  CortexOperationDef,
  CortexToolDescriptor,
  ToolRegistrationPayload,
} from "./types.js";

/**
 * Pure, deterministic. No IO.
 *
 * @throws RangeError when two tools would map to the same Cortex name
 *         (G-MAP invariant — duplicate operation names are forbidden).
 */
export function methodtsToCortex(input: {
  readonly methodologyId: string;
  readonly tools: ReadonlyArray<Tool<unknown>>;
  readonly roleAuthorizations: ReadonlyArray<{
    readonly roleId: string;
    readonly authorizedToolIds: ReadonlyArray<string>;
  }>;
  /** Optional per-tool JSON schemas declared in methodology YAML. */
  readonly schemas?: ReadonlyArray<{
    readonly toolId: string;
    readonly inputSchema?: Readonly<Record<string, unknown>>;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
  }>;
  /**
   * Optional warning sink. Called once per tool without a declared
   * inputSchema. No-op if absent (keeps the function pure in tests).
   */
  readonly onWarn?: (msg: string) => void;
}): ToolRegistrationPayload {
  const {
    methodologyId,
    tools,
    roleAuthorizations,
    schemas = [],
    onWarn,
  } = input;

  if (!isValidSegment(methodologyId)) {
    throw new RangeError(
      `methodologyId ${JSON.stringify(methodologyId)} is not a valid Cortex name segment (must match [A-Za-z0-9._-]+)`,
    );
  }

  const schemaByToolId = new Map(schemas.map((s) => [s.toolId, s]));

  const operations: CortexOperationDef[] = [];
  const toolDescriptors: CortexToolDescriptor[] = [];
  const sourceToolIdByOperationName = new Map<string, string>();

  for (const tool of tools) {
    const qualifiedName = qualifiedToolName(methodologyId, tool.id);
    if (sourceToolIdByOperationName.has(qualifiedName)) {
      throw new RangeError(
        `Duplicate operation name ${qualifiedName} (tool ${JSON.stringify(tool.id)} collides with existing ${JSON.stringify(sourceToolIdByOperationName.get(qualifiedName))}).`,
      );
    }
    sourceToolIdByOperationName.set(qualifiedName, tool.id);

    const declared = schemaByToolId.get(tool.id);
    const inputSchema = declared?.inputSchema ?? { type: "object" };
    if (!declared?.inputSchema && onWarn) {
      onWarn(
        `tool ${tool.id} in methodology ${methodologyId} has no declared inputSchema; emitting generic { type: 'object' }`,
      );
    }

    operations.push({
      name: qualifiedName,
      description: tool.description,
      transport: "mcp-tool",
      write: categoryToWrite(tool.category),
      scope: { methodologyId },
    });

    const descriptor: CortexToolDescriptor = {
      name: qualifiedName,
      operation: qualifiedName,
      displayName: tool.name,
      description: tool.description,
      inputSchema,
      ...(declared?.outputSchema ? { outputSchema: declared.outputSchema } : {}),
    };
    toolDescriptors.push(descriptor);
  }

  const authorizedSet = new Set(tools.map((t) => t.id));
  const suggestedPolicy = roleAuthorizations
    .map((ra) => ({
      role: ra.roleId,
      operations: ra.authorizedToolIds
        .filter((tid) => authorizedSet.has(tid))
        .map((tid) => qualifiedToolName(methodologyId, tid)),
    }))
    .filter((entry) => entry.operations.length > 0);

  return {
    operations,
    tools: toolDescriptors,
    ...(suggestedPolicy.length > 0 ? { suggestedPolicy } : {}),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function categoryToWrite(category: Tool<unknown>["category"]): boolean {
  switch (category) {
    case "write":
    case "execute":
      return true;
    case "read":
    case "communicate":
      return false;
  }
}

/**
 * `method.<methodologyId>.<toolId>` — flat namespace per RFC-005 §3.
 * Colons in the tool id become dots (Cortex disallows `:`).
 */
export function qualifiedToolName(
  methodologyId: string,
  toolId: string,
): string {
  const sanitized = toolId.replace(/:/g, ".");
  if (!isValidSegment(sanitized)) {
    throw new RangeError(
      `toolId ${JSON.stringify(toolId)} produces invalid Cortex segment ${JSON.stringify(sanitized)} (must match [A-Za-z0-9._-]+ after sanitization)`,
    );
  }
  return `method.${methodologyId}.${sanitized}`;
}

function isValidSegment(s: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(s);
}
