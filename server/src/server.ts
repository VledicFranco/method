import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadMethodologies } from './runtime/loader.js';
import { registerTools } from './tools/index.js';

export async function startServer(): Promise<void> {
  const methodologies = loadMethodologies();

  const server = new McpServer({
    name: 'method',
    version: '0.1.0',
  });

  registerTools(server, methodologies);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
