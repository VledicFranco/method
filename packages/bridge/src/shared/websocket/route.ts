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
  app.get('/ws', { websocket: true }, (connection: any, _request: any) => {
    // @fastify/websocket v11: handler receives WebSocket directly
    // Defensive: handle both raw socket and connection wrapper
    const socket: WebSocket = connection.socket ?? connection;
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
