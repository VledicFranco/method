/**
 * @method/mcp — Cortex transport barrel (PRD-066 Track A).
 *
 * Exports the frozen surface for S9 MCPCortexTransport. Track B handlers
 * plug in behind these exports without changing the public API.
 */

export * from "./types.js";
export { methodtsToCortex, qualifiedToolName } from "./cortex-mapping.js";
export {
  createCortexToolRegistrationClient,
} from "./cortex-tool-registration-client.js";
export type { CortexToolRegistrationClient } from "./cortex-tool-registration-client.js";
export {
  createMethodologyToolPublisher,
} from "./methodology-tool-publisher.js";
export type { MethodologyToolPublisher } from "./methodology-tool-publisher.js";
export {
  generateStaticToolsSection,
} from "./model-a-manifest.js";
export type {
  GenerateStaticToolsSectionInput,
  ToolsYaml,
} from "./model-a-manifest.js";
