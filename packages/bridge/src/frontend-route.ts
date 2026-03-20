/**
 * PRD 019.1: Narrative Flow Frontend — Static file server
 *
 * Serves the built React SPA from /app/* for the unified bridge frontend.
 * Follows the same pattern as strategy-viz-route.ts (manual readFileSync + MIME types).
 * SPA fallback: unmatched /app/* paths serve index.html for client-side routing.
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

export function registerFrontendRoutes(app: FastifyInstance): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const appDir = join(__dirname, 'app');

  // ── Redirect /app to /app/ ──

  app.get('/app', async (_request, reply) => {
    return reply.redirect('/app/');
  });

  // ── Serve the React SPA for any /app/* route ──

  app.get('/app/*', async (request, reply) => {
    const rawPath = (request.params as Record<string, string>)['*'] || 'index.html';

    // Security: reject path traversal
    if (rawPath.includes('..')) {
      return reply.status(400).send({ error: 'Invalid path' });
    }

    const filePath = join(appDir, rawPath);

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
    const indexPath = join(appDir, 'index.html');
    if (existsSync(indexPath)) {
      return reply.type('text/html; charset=utf-8').send(readFileSync(indexPath));
    }

    return reply.status(404).send({
      error: 'Frontend not built. Run: cd packages/bridge/frontend && npm install && npm run build',
    });
  });
}
