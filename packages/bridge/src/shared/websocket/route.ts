// ── WebSocket route registration for Fastify ────────────────

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import '@fastify/websocket'; // Type augmentation for websocket routes
import type { WsHub } from './hub.js';

/**
 * Register the `/ws` WebSocket endpoint.
 * Requires `@fastify/websocket` to be registered on the app first.
 */
export function registerWsRoute(app: FastifyInstance, hub: WsHub): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, _request) => {
    const clientId = hub.addClient(socket);

    socket.on('message', (raw: Buffer) => {
      hub.handleMessage(clientId, raw.toString());
    });

    socket.on('close', () => {
      hub.removeClient(clientId);
    });

    socket.on('error', () => {
      hub.removeClient(clientId);
    });
  });
}
