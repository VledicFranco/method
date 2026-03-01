/**
 * HTTP API entry point — serves methodology data for the web interface.
 * Runs independently from the MCP stdio server.
 * Default port: 3001
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadMethodologies } from './runtime/loader.js';

const PORT = Number(process.env.API_PORT ?? 3001);

const methodologies = loadMethodologies();

const app = new Hono();

app.use('*', cors());

app.get('/methodologies', (c) => {
  const list = Array.from(methodologies.values()).map((m) => ({
    name: m.name,
    description: m.description,
    phase_count: m.phases.length,
  }));
  return c.json(list);
});

app.get('/methodologies/:name', (c) => {
  const name = c.req.param('name');
  const m = methodologies.get(name);
  if (!m) return c.json({ error: 'Not found' }, 404);
  return c.json(m);
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.error(`Method API listening on http://localhost:${PORT}`);
});
