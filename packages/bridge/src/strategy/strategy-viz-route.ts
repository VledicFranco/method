/**
 * PRD 018 Phase 2b-viz: Strategy Pipeline Visualizer — Static file server
 *
 * Serves the built React SPA from /viz/* for strategy DAG visualization.
 * The DAG API endpoint is in strategy-routes.ts (has access to the executions map).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript',
  css: 'text/css',
  svg: 'image/svg+xml',
  json: 'application/json',
  png: 'image/png',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

export function registerStrategyVizRoutes(app: FastifyInstance): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const vizDir = join(__dirname, '..', 'viz');

  // ── Serve the React SPA for any /viz/* route ──

  app.get('/viz', async (_request, reply) => {
    return reply.redirect('/viz/');
  });

  app.get('/viz/*', async (request, reply) => {
    const rawPath = (request.params as Record<string, string>)['*'] || 'index.html';

    // Security: reject path traversal
    if (rawPath.includes('..')) {
      return reply.status(400).send({ error: 'Invalid path' });
    }

    const filePath = join(vizDir, rawPath);

    // Try to serve the exact file
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath);
        const ext = rawPath.split('.').pop() ?? 'html';
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        return reply.type(mime).send(content);
      } catch {
        // Fall through to SPA fallback
      }
    }

    // SPA fallback: serve index.html for client-side routing
    const indexPath = join(vizDir, 'index.html');
    if (existsSync(indexPath)) {
      return reply.type('text/html; charset=utf-8').send(readFileSync(indexPath));
    }

    return reply.status(404).send({
      error: 'Visualizer not built. Run: cd packages/bridge/viz && npm install && npm run build',
    });
  });
}
