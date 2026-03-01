/**
 * Method server — unified HTTP entry point.
 *
 * Serves:
 *   POST   /mcp               MCP Streamable HTTP (tool calls)
 *   GET    /mcp               MCP SSE stream (server → client)
 *   DELETE /mcp               MCP session teardown
 *   GET    /methodologies     REST — list summaries
 *   GET    /methodologies/:n  REST — full methodology
 *
 * Connect from Claude:  { "url": "http://localhost:3001/mcp" }
 * Web visualizer:       http://localhost:5173  (Vite dev, proxied)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadMethodologies } from './runtime/loader.js';
import { registerTools } from './tools/index.js';

const PORT = Number(process.env.PORT ?? 3001);

// ── Shared state ──────────────────────────────────────────────────────────────

const methodologies = loadMethodologies();

// ── REST API ─────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', cors());

app.get('/methodologies', (c) =>
  c.json(
    Array.from(methodologies.values()).map((m) => ({
      name: m.name,
      description: m.description,
      phase_count: m.phases.length,
    })),
  ),
);

app.get('/methodologies/:name', (c) => {
  const m = methodologies.get(c.req.param('name'));
  return m ? c.json(m) : c.json({ error: 'Not found' }, 404);
});

const restHandler = getRequestListener(app.fetch);

// ── MCP HTTP transport ────────────────────────────────────────────────────────

const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      if (!text) { resolve(undefined); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function isInitializeBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    (body as Record<string, unknown>).method === 'initialize'
  );
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Route existing session (any method: POST, GET, DELETE)
  if (sessionId) {
    const transport = mcpSessions.get(sessionId);
    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await transport.handleRequest(req, res, body);
    return;
  }

  // New connection — must be POST initialize
  if (req.method !== 'POST') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'New connections require POST initialize' }));
    return;
  }

  const body = await readBody(req);
  if (!isInitializeBody(body)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected initialize request' }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      mcpSessions.set(id, transport);
      transport.onclose = () => mcpSessions.delete(id);
    },
  });

  const mcpServer = new McpServer({ name: 'method', version: '0.1.0' });
  registerTools(mcpServer, methodologies);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, body);
}

// ── Combined HTTP server ──────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
    try {
      await handleMcp(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      console.error('MCP error:', err);
    }
    return;
  }
  restHandler(req, res);
});

httpServer.listen(PORT, () => {
  console.error(`Method server on http://localhost:${PORT}`);
  console.error(`  MCP  → POST http://localhost:${PORT}/mcp`);
  console.error(`  API  → GET  http://localhost:${PORT}/methodologies`);
});
