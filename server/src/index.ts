/**
 * Method server — unified HTTP entry point.
 *
 * Serves:
 *   POST   /mcp               MCP Streamable HTTP (tool calls)
 *   GET    /mcp               MCP SSE stream (server → client)
 *   DELETE /mcp               MCP session teardown
 *   GET    /methodologies     REST — list summaries
 *   GET    /methodologies/:n  REST — full methodology
 *   GET    /projects          REST — all projects
 *   GET    /projects/:slug/sessions  REST — sessions for a project
 *   GET    /sessions          REST — all sessions (optional ?project= / ?status= filter)
 *   GET    /sessions/:id      REST — single session with phase_outputs
 *   GET    /events            REST — recent phase events (optional ?session= / ?limit=)
 *   GET    /stats             REST — aggregate stats
 *
 * Connect from Claude:  { "url": "http://localhost:47821/mcp" }
 * Web visualizer:       http://localhost:47820
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { desc, eq, sql } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { runMigrations } from './db/migrate.js';
import { db } from './db/index.js';
import { projects, sessions, methodologies as methodologiesTable, phase_events } from './db/schema.js';
import { loadMethodologies } from './runtime/loader.js';
import { registerTools } from './tools/index.js';

const PORT = Number(process.env.PORT ?? 47821);

async function main() {
  // ── Startup sequence ──────────────────────────────────────────────────────
  await runMigrations();
  const methodologies = await loadMethodologies();

  // ── REST API ───────────────────────────────────────────────────────────────
  const app = new Hono();
  app.use('*', cors());

  // Methodologies
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

  // Projects
  app.get('/projects', async (c) => {
    const rows = await db.select().from(projects).orderBy(projects.created_at);
    return c.json(rows);
  });

  app.get('/projects/:slug/sessions', async (c) => {
    const slug = c.req.param('slug');
    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);

    if (projectRows.length === 0) return c.json({ error: 'Project not found' }, 404);

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.project_id, projectRows[0].id))
      .orderBy(sessions.created_at);

    return c.json(rows);
  });

  // Sessions
  app.get('/sessions', async (c) => {
    const projectSlug = c.req.query('project');
    const statusFilter = c.req.query('status') as 'active' | 'complete' | undefined;

    if (projectSlug) {
      const projectRows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, projectSlug))
        .limit(1);

      if (projectRows.length === 0) return c.json([]);

      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.project_id, projectRows[0].id))
        .orderBy(sessions.updated_at);

      return c.json(rows);
    }

    if (statusFilter === 'active' || statusFilter === 'complete') {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.status, statusFilter))
        .orderBy(desc(sessions.updated_at));
      return c.json(rows);
    }

    const rows = await db.select().from(sessions).orderBy(desc(sessions.updated_at));
    return c.json(rows);
  });

  // Events
  app.get('/events', async (c) => {
    const sessionFilter = c.req.query('session');
    const limitParam = c.req.query('limit');
    const limit = Math.min(Number(limitParam ?? 50) || 50, 100);

    if (sessionFilter) {
      const rows = await db
        .select({
          id: phase_events.id,
          session_id: phase_events.session_id,
          phase_index: phase_events.phase_index,
          event: phase_events.event,
          payload: phase_events.payload,
          created_at: phase_events.created_at,
          methodology_name: sessions.methodology_name,
          project_id: sessions.project_id,
        })
        .from(phase_events)
        .leftJoin(sessions, eq(phase_events.session_id, sessions.id))
        .where(eq(phase_events.session_id, sessionFilter))
        .orderBy(desc(phase_events.created_at))
        .limit(limit);
      return c.json(rows);
    }

    const rows = await db
      .select({
        id: phase_events.id,
        session_id: phase_events.session_id,
        phase_index: phase_events.phase_index,
        event: phase_events.event,
        payload: phase_events.payload,
        created_at: phase_events.created_at,
        methodology_name: sessions.methodology_name,
        project_id: sessions.project_id,
      })
      .from(phase_events)
      .leftJoin(sessions, eq(phase_events.session_id, sessions.id))
      .orderBy(desc(phase_events.created_at))
      .limit(limit);
    return c.json(rows);
  });

  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return rows.length > 0 ? c.json(rows[0]) : c.json({ error: 'Not found' }, 404);
  });

  // Stats
  app.get('/stats', async (c) => {
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions);

    const [completedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.status, 'complete'));

    const [methodCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(methodologiesTable);

    const byMethodology = await db
      .select({
        methodology_name: sessions.methodology_name,
        count: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .groupBy(sessions.methodology_name);

    return c.json({
      total_sessions: totalRow?.count ?? 0,
      completed_sessions: completedRow?.count ?? 0,
      methodologies_count: methodCountRow?.count ?? 0,
      sessions_by_methodology: byMethodology,
    });
  });

  const restHandler = getRequestListener(app.fetch);

  // ── MCP HTTP transport ────────────────────────────────────────────────────
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

  // ── Combined HTTP server ──────────────────────────────────────────────────
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
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
