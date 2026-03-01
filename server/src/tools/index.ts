import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Methodology } from '../schema.js';
import { registerList } from './list.js';
import { registerStart } from './start.js';
import { registerAdvance } from './advance.js';
import { registerStatus } from './status.js';
import { registerReload } from './reload.js';
import { registerImport } from './import.js';

export function registerTools(server: McpServer, methodologies: Map<string, Methodology>): void {
  registerList(server, methodologies);
  registerStart(server, methodologies);
  registerAdvance(server, methodologies);
  registerStatus(server, methodologies);
  registerReload(server, methodologies);
  registerImport(server, methodologies);
}
