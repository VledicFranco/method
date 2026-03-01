/**
 * MCP Server entry point — method methodology enforcement server.
 *
 * Runs on stdio transport. Start with: tsx src/index.ts
 */

import { startServer } from './server.js';

startServer().catch((err: unknown) => {
  console.error('Failed to start method server:', err);
  process.exit(1);
});
